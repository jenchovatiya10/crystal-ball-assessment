import type { Approval } from "@crystal-ball/shared";
import type { AIProvider } from "../ai/AIProvider.js";
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

  async *streamTurn(params: StreamTurnParams): AsyncIterable<string> {
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
        chunks.push(chunk);
        yield chunk;
      }
    } catch (error) {
      // Interrupted / failed streams must not persist a completed assistant turn.
      if (isAbortError(error)) {
        throw error;
      }
      throw error;
    }

    const assistantMessage = chunks.join("");
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
