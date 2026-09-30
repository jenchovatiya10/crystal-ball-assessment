import type { AIProvider } from "./AIProvider.js";
import type { GenerateStructuredParams, StreamParams } from "./types.js";

export type FakeAIProviderOptions = {
  /** Successful raw value(s) to parse with the caller's Zod schema. */
  structuredResponse?: unknown;
  /** Queue of structured responses consumed in order. */
  structuredResponses?: unknown[];
  /** Raw value that should fail schema validation. */
  invalidStructuredResponse?: unknown;
  /** Artificial latency before resolving/yielding. */
  delayMs?: number;
  /** Thrown from generateStructured / before stream tokens. */
  error?: Error;
  /** Token chunks yielded by stream(). */
  streamTokens?: string[];
  /** If set, throw after yielding this many tokens. */
  streamFailAfter?: number;
  /** Error used when streamFailAfter is hit (default Error). */
  streamError?: Error;
};

function abortError(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}

async function waitForDelay(
  delayMs: number | undefined,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    throw abortError(signal);
  }
  if (delayMs == null || delayMs <= 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);

    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Test double for AIProvider. Configurable success, validation, delay,
 * errors, and streaming failure — no network and no real LLM.
 */
export class FakeAIProvider implements AIProvider {
  private structuredQueue: unknown[];
  private readonly options: FakeAIProviderOptions;

  constructor(options: FakeAIProviderOptions = {}) {
    this.options = options;
    this.structuredQueue = [...(options.structuredResponses ?? [])];
    if (
      options.structuredResponse !== undefined &&
      this.structuredQueue.length === 0
    ) {
      this.structuredQueue.push(options.structuredResponse);
    }
  }

  async generateStructured<T>(
    params: GenerateStructuredParams<T>,
  ): Promise<T> {
    await waitForDelay(this.options.delayMs, params.signal);

    if (this.options.error) {
      throw this.options.error;
    }

    const raw =
      this.options.invalidStructuredResponse !== undefined
        ? this.options.invalidStructuredResponse
        : this.nextStructuredRaw();

    return params.schema.parse(raw);
  }

  async *stream(params: StreamParams): AsyncIterable<string> {
    await waitForDelay(this.options.delayMs, params.signal);

    if (this.options.error) {
      throw this.options.error;
    }

    const tokens = this.options.streamTokens ?? [];
    const failAfter = this.options.streamFailAfter;
    const streamError =
      this.options.streamError ?? new Error("Fake stream failure");

    for (let i = 0; i < tokens.length; i += 1) {
      if (params.signal?.aborted) {
        throw abortError(params.signal);
      }
      if (failAfter != null && i >= failAfter) {
        throw streamError;
      }
      yield tokens[i]!;
    }

    if (failAfter != null && failAfter >= tokens.length) {
      throw streamError;
    }
  }

  private nextStructuredRaw(): unknown {
    if (this.structuredQueue.length > 0) {
      return this.structuredQueue.shift();
    }
    if (this.options.structuredResponse !== undefined) {
      return this.options.structuredResponse;
    }
    throw new Error("FakeAIProvider: no structured response configured");
  }
}
