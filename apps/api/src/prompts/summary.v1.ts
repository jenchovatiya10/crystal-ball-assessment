import type { Priority, SummaryResponse } from "@crystal-ball/shared";
import type { RankedApproval } from "../services/ranking.service.js";

export const SUMMARY_PROMPT_VERSION = "summary.v1" as const;

export type SummaryPromptApproval = {
  approvalId: string;
  title: string;
  type: string;
  dueAt: string;
  flags: string[];
  score: number;
  priority: Priority;
  reasons: string[];
};

export type SummaryPromptInput = {
  promptVersion: typeof SUMMARY_PROMPT_VERSION;
  rankedApprovals: SummaryPromptApproval[];
};

/**
 * Versioned Present Me Summary prompt.
 * Ranking is supplied; the model may only explain it.
 */
export function buildSummaryPrompt(input: SummaryPromptInput): string {
  return [
    `Prompt version: ${SUMMARY_PROMPT_VERSION}`,
    "You are assisting an approvals reviewer.",
    "A deterministic RankingService already ranked the approvals.",
    "Do not invent a new ranking. Do not reorder items. Do not change priorities.",
    "Explain the supplied ranking: write overview text, copy each approvalId with its given priority, and give a short reason grounded in the supplied reasons/flags/due dates.",
    "Return JSON matching SummaryResponse: overview, priorityItems[{approvalId, priority, reason}], recommendedNextAction.",
    "Use every ranked approvalId exactly once, in the supplied order.",
    "Ranked approvals JSON:",
    JSON.stringify(input.rankedApprovals),
  ].join("\n");
}

export function toSummaryPromptInput(
  ranked: readonly RankedApproval[],
  titlesById: ReadonlyMap<string, string>,
  approvalsById: ReadonlyMap<
    string,
    { type: string; dueAt: string; flags: string[] }
  >,
): SummaryPromptInput {
  return {
    promptVersion: SUMMARY_PROMPT_VERSION,
    rankedApprovals: ranked.map((item) => {
      const meta = approvalsById.get(item.approvalId);
      return {
        approvalId: item.approvalId,
        title: titlesById.get(item.approvalId) ?? item.approvalId,
        type: meta?.type ?? "unknown",
        dueAt: meta?.dueAt ?? "",
        flags: meta?.flags ?? [],
        score: item.score,
        priority: item.priority,
        reasons: item.reasons,
      };
    }),
  };
}

/** Type helper documenting the expected AI JSON shape for this prompt. */
export type SummaryPromptExpectedOutput = SummaryResponse;
