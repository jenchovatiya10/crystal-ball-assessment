import {
  HelpRequestSchema,
  HelpResponseSchema,
  type HelpResponse,
} from "@crystal-ball/shared";
import { ZodError } from "zod";
import type { AIProvider } from "../ai/AIProvider.js";
import {
  AIInvalidOutputError,
  AITimeoutError,
  AIUnavailableError,
} from "../ai/resilience.js";
import {
  HELP_PROMPT_VERSION,
  buildHelpPrompt,
  type HelpPromptInput,
} from "../prompts/help.v1.js";
import { KEYWORD_TOP_K } from "../rag/keywordRetriever.js";
import type { Retriever, ScoredChunk } from "../rag/Retriever.js";
import {
  buildHelpFallback,
  buildHelpNoSourcesFallback,
} from "./fallbacks.js";

export type HelpFallbackReason =
  | "timeout"
  | "invalid_output"
  | "unavailable"
  | "no_sources";

export type HelpResultMeta = {
  source: "ai" | "fallback";
  reason?: HelpFallbackReason;
  promptVersion: typeof HELP_PROMPT_VERSION;
};

export type HelpResult = {
  data: HelpResponse;
  meta: HelpResultMeta;
};

export type HelpServiceOptions = {
  topK?: number;
};

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function fallbackReason(error: unknown): HelpFallbackReason {
  if (error instanceof AITimeoutError) return "timeout";
  if (error instanceof AIUnavailableError) return "unavailable";
  if (error instanceof AIInvalidOutputError) return "invalid_output";
  if (error instanceof ZodError) return "invalid_output";
  if (isAbortError(error)) return "timeout";
  return "unavailable";
}

/** Every cited source must be one of the retrieved chunk IDs. */
export function validateHelpSemantics(
  response: HelpResponse,
  retrievedIds: ReadonlySet<string>,
): boolean {
  if (!response.grounded) {
    return response.sources.length === 0;
  }
  if (response.sources.length === 0) {
    return false;
  }
  return response.sources.every((source) => retrievedIds.has(source));
}

export class HelpService {
  private readonly topK: number;

  constructor(
    private readonly ai: AIProvider,
    private readonly retriever: Retriever,
    options: HelpServiceOptions = {},
  ) {
    this.topK = options.topK ?? KEYWORD_TOP_K;
  }

  async ask(question: string, signal?: AbortSignal): Promise<HelpResult> {
    const parsedQuestion = HelpRequestSchema.parse({ question }).question;
    const retrieved = await this.retriever.retrieve(parsedQuestion, this.topK);

    if (retrieved.length === 0) {
      return {
        data: buildHelpNoSourcesFallback(),
        meta: {
          source: "fallback",
          reason: "no_sources",
          promptVersion: HELP_PROMPT_VERSION,
        },
      };
    }

    const retrievedIds = new Set(retrieved.map((chunk) => chunk.id));
    const promptInput: HelpPromptInput = {
      promptVersion: HELP_PROMPT_VERSION,
      question: parsedQuestion,
      chunks: retrieved.map(({ id, title, text }) => ({ id, title, text })),
    };
    const prompt = buildHelpPrompt(promptInput);

    try {
      const raw = await this.ai.generateStructured({
        prompt,
        input: promptInput,
        schema: HelpResponseSchema,
        signal,
      });

      if (!validateHelpSemantics(raw, retrievedIds)) {
        return this.fallback(retrieved, "invalid_output");
      }

      return {
        data: raw,
        meta: {
          source: "ai",
          promptVersion: HELP_PROMPT_VERSION,
        },
      };
    } catch (error) {
      return this.fallback(retrieved, fallbackReason(error));
    }
  }

  private fallback(
    chunks: readonly ScoredChunk[],
    reason: HelpFallbackReason,
  ): HelpResult {
    return {
      data: buildHelpFallback(chunks),
      meta: {
        source: "fallback",
        reason,
        promptVersion: HELP_PROMPT_VERSION,
      },
    };
  }
}
