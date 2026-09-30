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

function toErrorPayload(error: unknown): {
  code: string;
  message: string;
} {
  // Client-facing only — never forward raw provider / SDK messages.
  if (error instanceof AITimeoutError) {
    return {
      code: error.code,
      message: "The AI request timed out. Please try again.",
    };
  }
  if (error instanceof AIUnavailableError) {
    return {
      code: error.code,
      message: "The AI service is temporarily unavailable. Please try again.",
    };
  }
  return {
    code: "STREAM_ERROR",
    message: "Stream interrupted",
  };
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
   * HTTP-oriented stream with mid-stream error handling and history save only
   * after successful completion (including fallback done).
   * Transient pre-token retry lives in ResilientAIProvider — do not retry here
   * (avoids stacked retries / duplicate provider work).
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

      // Pre-first-token failure after provider retry budget → fallback.
      yield { type: "token", t: STREAM_FALLBACK_TEXT };
      this.persistCompleted(params, STREAM_FALLBACK_TEXT);
      yield { type: "done", fallback: true };
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
