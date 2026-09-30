import { ZodError } from "zod";
import type { AIProvider } from "./AIProvider.js";
import type { GenerateStructuredParams, StreamParams } from "./types.js";

/** Default AI call budget — architecture requirement. */
export const AI_TIMEOUT_MS = 8_000;

export type ResilienceOptions = {
  /** Override for tests; production default is 8000ms. */
  timeoutMs?: number;
};

export class AITimeoutError extends Error {
  readonly code = "AI_TIMEOUT" as const;

  constructor(message = "AI request timed out after 8 seconds") {
    super(message);
    this.name = "AITimeoutError";
  }
}

export class AIUnavailableError extends Error {
  readonly code = "AI_UNAVAILABLE" as const;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(
    message: string,
    options: { retryable?: boolean; status?: number; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AIUnavailableError";
    this.retryable = options.retryable ?? true;
    if (options.status !== undefined) {
      this.status = options.status;
    }
  }
}

export class AIInvalidOutputError extends Error {
  readonly code = "AI_INVALID_OUTPUT" as const;

  constructor(message = "AI returned invalid structured output", cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "AIInvalidOutputError";
  }
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function isTransient(error: unknown): boolean {
  if (error instanceof AITimeoutError) return false;
  if (error instanceof AIInvalidOutputError) return false;
  if (isAbortError(error)) return false;
  if (error instanceof AIUnavailableError) return error.retryable;

  if (typeof error === "object" && error !== null && "status" in error) {
    const status = Number((error as { status: unknown }).status);
    if (status >= 500 && status < 600) return true;
  }

  if (error instanceof TypeError) return true;

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (/network|econnreset|etimedout|econnrefused|fetch failed|socket/.test(msg)) {
      return true;
    }
    if (/^5\d\d\b/.test(error.message)) return true;
  }

  return false;
}

function mapProviderError(
  error: unknown,
  ctx: { wasTimeout: boolean; wasCallerAbort: boolean },
): Error {
  if (ctx.wasCallerAbort) {
    if (error instanceof Error) return error;
    const aborted = new Error("Aborted");
    aborted.name = "AbortError";
    return aborted;
  }

  if (ctx.wasTimeout || error instanceof AITimeoutError) {
    return error instanceof AITimeoutError
      ? error
      : new AITimeoutError();
  }

  if (error instanceof AIUnavailableError || error instanceof AIInvalidOutputError) {
    return error;
  }

  if (error instanceof ZodError) {
    return new AIInvalidOutputError("AI returned invalid structured output", error);
  }

  if (isAbortError(error)) {
    return error as Error;
  }

  const message =
    error instanceof Error ? error.message : "AI provider unavailable";
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
      ? (error as { status: number }).status
      : undefined;

  return new AIUnavailableError(message, {
    retryable: isTransient(error) || (status !== undefined && status >= 500),
    status,
    cause: error,
  });
}

type AttemptSignal = {
  signal: AbortSignal;
  cleanup: () => void;
  wasTimeout: () => boolean;
  wasCallerAbort: () => boolean;
};

function createAttemptSignal(
  caller: AbortSignal | undefined,
  timeoutMs: number,
): AttemptSignal {
  const timeoutController = new AbortController();
  const timer = setTimeout(() => {
    timeoutController.abort(new AITimeoutError());
  }, timeoutMs);

  const signal =
    caller != null
      ? AbortSignal.any([caller, timeoutController.signal])
      : timeoutController.signal;

  return {
    signal,
    cleanup: () => clearTimeout(timer),
    wasTimeout: () =>
      timeoutController.signal.aborted && !(caller?.aborted ?? false),
    wasCallerAbort: () => Boolean(caller?.aborted),
  };
}

class ResilientAIProvider implements AIProvider {
  constructor(
    private readonly inner: AIProvider,
    private readonly timeoutMs: number,
  ) {}

  async generateStructured<T>(
    params: GenerateStructuredParams<T>,
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const attemptSignal = createAttemptSignal(params.signal, this.timeoutMs);
      try {
        const result = await this.inner.generateStructured({
          ...params,
          signal: attemptSignal.signal,
        });
        attemptSignal.cleanup();
        return result;
      } catch (error) {
        attemptSignal.cleanup();
        const mapped = mapProviderError(error, {
          wasTimeout: attemptSignal.wasTimeout(),
          wasCallerAbort: attemptSignal.wasCallerAbort(),
        });
        lastError = mapped;

        const canRetry =
          attempt === 0 &&
          !(mapped instanceof AITimeoutError) &&
          !isAbortError(mapped) &&
          isTransient(mapped);

        if (!canRetry) {
          throw mapped;
        }
      }
    }

    throw lastError ?? new AIUnavailableError("AI provider unavailable");
  }

  async *stream(params: StreamParams): AsyncIterable<string> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const attemptSignal = createAttemptSignal(params.signal, this.timeoutMs);
      let emitted = false;

      try {
        for await (const token of this.inner.stream({
          ...params,
          signal: attemptSignal.signal,
        })) {
          emitted = true;
          yield token;
        }
        attemptSignal.cleanup();
        return;
      } catch (error) {
        attemptSignal.cleanup();
        const mapped = mapProviderError(error, {
          wasTimeout: attemptSignal.wasTimeout(),
          wasCallerAbort: attemptSignal.wasCallerAbort(),
        });

        const canRetry =
          attempt === 0 &&
          !emitted &&
          !(mapped instanceof AITimeoutError) &&
          !isAbortError(mapped) &&
          isTransient(mapped);

        if (!canRetry) {
          throw mapped;
        }
        // Pre-first-token transient failure → retry once.
      }
    }
  }
}

/**
 * Wraps an AIProvider with timeout, abort propagation, typed errors,
 * and a single retry for transient failures (not timeouts; not mid-stream).
 */
export function createResilientAIProvider(
  inner: AIProvider,
  options: ResilienceOptions = {},
): AIProvider {
  return new ResilientAIProvider(inner, options.timeoutMs ?? AI_TIMEOUT_MS);
}
