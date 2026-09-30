import type { Approval } from "@crystal-ball/shared";
import type { AIProvider } from "../ai/AIProvider.js";
import {
  AITimeoutError,
  AIUnavailableError,
} from "../ai/resilience.js";
import type { AIMessage } from "../ai/types.js";
import { APPROVALS } from "../fixtures/approvals.js";
import { buildChatPrompt, CHAT_PROMPT_VERSION } from "../prompts/chat.v1.js";
import { buildTeachPrompt, TEACH_PROMPT_VERSION } from "../prompts/teach.v1.js";
import {
  ConversationStore,
  type ConversationMode,
} from "./conversationStore.js";

export type StreamTurnParams = {
  sessionId: string;
  mode: ConversationMode;
  message: string;
  signal?: AbortSignal;
};

export type ConversationServiceOptions = {
  approvals?: readonly Approval[];
};

export type AssistantStreamEvent =
  | { type: "token"; t: string }
  | { type: "done"; fallback?: boolean }
  | { type: "error"; code: string; message: string; fallback: true };

export const STREAM_FALLBACK_TEXT =
  "I could not complete that response due to a temporary AI issue. Please try again.";

function compactApprovalContext(approvals: readonly Approval[]): string {
  const lines = approvals.map((approval) => {
    const flags = approval.flags.length > 0 ? approval.flags.join(",") : "none";
    return `- ${approval.id} | ${approval.type} | ${approval.title} | due ${approval.dueAt} | flags:${flags}`;
  });
  return ["Compact approval context:", ...lines].join("\n");
}

function selectPrompt(mode: ConversationMode): {
  version: string;
  prompt: string;
} {
  if (mode === "teach_me") {
    return { version: TEACH_PROMPT_VERSION, prompt: buildTeachPrompt() };
  }
  return { version: CHAT_PROMPT_VERSION, prompt: buildChatPrompt() };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function abortFromSignal(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}

function isTransient(error: unknown): boolean {
  if (error instanceof AITimeoutError) return false;
  if (isAbortError(error)) return false;
  if (error instanceof AIUnavailableError) return error.retryable;
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (/network|econnreset|etimedout|econnrefused|fetch failed|socket/.test(msg)) {
      return true;
    }
    if (/^5\d\d\b/.test(error.message)) return true;
  }
  return false;
}

function toErrorPayload(error: unknown): {
  code: string;
  message: string;
} {
  if (error instanceof AITimeoutError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof AIUnavailableError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { code: "STREAM_ERROR", message: error.message || "Stream interrupted" };
  }
  return { code: "STREAM_ERROR", message: "Stream interrupted" };
}

/**
 * Shared Talk to Me / Teach Me streaming conversation orchestration.
 */
export class ConversationService {
  private readonly approvals: readonly Approval[];

  constructor(
    private readonly ai: AIProvider,
    private readonly store: ConversationStore,
    options: ConversationServiceOptions = {},
  ) {
    this.approvals = options.approvals ?? APPROVALS;
  }

  /** Low-level token stream used by unit tests; saves only on full success. */
  async *streamTurn(params: StreamTurnParams): AsyncIterable<string> {
    for await (const event of this.runAssistantStream(params)) {
      if (event.type === "token") {
        yield event.t;
      } else if (event.type === "error") {
        throw new Error(event.message);
      }
    }
  }

  /**
   * HTTP-oriented stream with pre-first-token retry + fallback, mid-stream error,
   * and history save only after successful completion (including fallback done).
   */
  async *runAssistantStream(
    params: StreamTurnParams,
  ): AsyncIterable<AssistantStreamEvent> {
    if (params.signal?.aborted) {
      throw abortFromSignal(params.signal);
    }

    const history = this.store.getHistory(params.sessionId, params.mode);
    const { prompt: basePrompt } = selectPrompt(params.mode);
    const prompt = [
      basePrompt,
      "",
      compactApprovalContext(this.approvals),
    ].join("\n");

    const messages: AIMessage[] = [
      ...history.map((turn) => ({
        role: turn.role,
        content: turn.content,
      })),
      { role: "user", content: params.message },
    ];

    let emitted = false;
    const chunks: string[] = [];

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        for await (const chunk of this.ai.stream({
          prompt,
          messages,
          signal: params.signal,
        })) {
          if (params.signal?.aborted) {
            throw abortFromSignal(params.signal);
          }
          emitted = true;
          chunks.push(chunk);
          yield { type: "token", t: chunk };
        }

        this.persistCompleted(params, chunks.join(""));
        yield { type: "done" };
        return;
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }

        if (emitted) {
          const payload = toErrorPayload(error);
          yield {
            type: "error",
            code: payload.code,
            message: payload.message,
            fallback: true,
          };
          return;
        }

        const canRetry = attempt === 0 && isTransient(error);
        if (canRetry) {
          continue;
        }

        // Pre-first-token failure after retry budget → fallback tokens + done.
        yield { type: "token", t: STREAM_FALLBACK_TEXT };
        this.persistCompleted(params, STREAM_FALLBACK_TEXT);
        yield { type: "done", fallback: true };
        return;
      }
    }
  }

  private persistCompleted(
    params: StreamTurnParams,
    assistantMessage: string,
  ): void {
    this.store.append(params.sessionId, params.mode, {
      role: "user",
      content: params.message,
    });
    this.store.append(params.sessionId, params.mode, {
      role: "assistant",
      content: assistantMessage,
    });
  }
}
