import {
  SummaryResponseSchema,
  type Approval,
  type SummaryResponse,
} from "@crystal-ball/shared";
import { ZodError } from "zod";
import type { AIProvider } from "../ai/AIProvider.js";
import {
  AIInvalidOutputError,
  AITimeoutError,
  AIUnavailableError,
} from "../ai/resilience.js";
import { APPROVALS } from "../fixtures/approvals.js";
import {
  SUMMARY_PROMPT_VERSION,
  buildSummaryPrompt,
  toSummaryPromptInput,
} from "../prompts/summary.v1.js";
import { buildSummaryFallback } from "./fallbacks.js";
import { rankApprovals, type RankedApproval } from "./ranking.service.js";

export type SummaryFallbackReason =
  | "timeout"
  | "invalid_output"
  | "unavailable";

export type SummaryResultMeta = {
  source: "ai" | "fallback";
  reason?: SummaryFallbackReason;
  promptVersion: typeof SUMMARY_PROMPT_VERSION;
};

export type SummaryResult = {
  data: SummaryResponse;
  meta: SummaryResultMeta;
};

export type SummaryServiceOptions = {
  now?: Date;
  approvals?: readonly Approval[];
};

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function fallbackReason(error: unknown): SummaryFallbackReason {
  if (error instanceof AITimeoutError) return "timeout";
  if (error instanceof AIUnavailableError) return "unavailable";
  if (error instanceof AIInvalidOutputError) return "invalid_output";
  if (error instanceof ZodError) return "invalid_output";
  if (isAbortError(error)) return "timeout";
  return "unavailable";
}

/**
 * Semantic checks: IDs must exist; order + priorities must match RankingService.
 * The LLM must not invent ranking.
 */
export function validateSummarySemantics(
  summary: SummaryResponse,
  ranked: readonly RankedApproval[],
  approvalIds: ReadonlySet<string>,
): boolean {
  if (summary.priorityItems.length !== ranked.length) {
    return false;
  }

  for (let i = 0; i < ranked.length; i += 1) {
    const expected = ranked[i]!;
    const actual = summary.priorityItems[i]!;
    if (!approvalIds.has(actual.approvalId)) return false;
    if (actual.approvalId !== expected.approvalId) return false;
    if (actual.priority !== expected.priority) return false;
  }

  return true;
}

export class SummaryService {
  private readonly now: Date;
  private readonly approvals: readonly Approval[];

  constructor(
    private readonly ai: AIProvider,
    options: SummaryServiceOptions = {},
  ) {
    this.now = options.now ?? new Date();
    this.approvals = options.approvals ?? APPROVALS;
  }

  async presentSummary(signal?: AbortSignal): Promise<SummaryResult> {
    const ranked = rankApprovals(this.approvals, this.now);
    const approvalIds = new Set(this.approvals.map((a) => a.id));
    const titlesById = new Map(this.approvals.map((a) => [a.id, a.title]));
    const approvalsById = new Map(
      this.approvals.map((a) => [
        a.id,
        { type: a.type, dueAt: a.dueAt, flags: [...a.flags] },
      ]),
    );

    const promptInput = toSummaryPromptInput(ranked, titlesById, approvalsById);
    const prompt = buildSummaryPrompt(promptInput);

    try {
      const raw = await this.ai.generateStructured({
        prompt,
        input: promptInput,
        schema: SummaryResponseSchema,
        signal,
      });

      if (!validateSummarySemantics(raw, ranked, approvalIds)) {
        return this.fallback(ranked, "invalid_output");
      }

      return {
        data: raw,
        meta: {
          source: "ai",
          promptVersion: SUMMARY_PROMPT_VERSION,
        },
      };
    } catch (error) {
      return this.fallback(ranked, fallbackReason(error));
    }
  }

  private fallback(
    ranked: readonly RankedApproval[],
    reason: SummaryFallbackReason,
  ): SummaryResult {
    return {
      data: buildSummaryFallback(ranked, this.approvals),
      meta: {
        source: "fallback",
        reason,
        promptVersion: SUMMARY_PROMPT_VERSION,
      },
    };
  }
}
