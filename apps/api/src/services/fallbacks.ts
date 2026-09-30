import type { Approval, SummaryResponse } from "@crystal-ball/shared";
import type { RankedApproval } from "./ranking.service.js";

/**
 * Deterministic Present Me Summary fallback — HTTP-safe domain data, never throws.
 */
export function buildSummaryFallback(
  ranked: readonly RankedApproval[],
  approvals: readonly Approval[],
): SummaryResponse {
  const byId = new Map(approvals.map((a) => [a.id, a]));
  const count = ranked.length;
  const top = ranked[0];
  const topTitle = top ? byId.get(top.approvalId)?.title ?? top.approvalId : null;

  const overview =
    count === 0
      ? "There are no approvals waiting right now."
      : `You have ${count} approval${count === 1 ? "" : "s"} waiting, ordered by deterministic urgency ranking.`;

  const priorityItems = ranked.map((item) => {
    const approval = byId.get(item.approvalId);
    const reason =
      item.reasons[0] ??
      `Ranked ${item.priority} (score ${item.score})` +
        (approval ? ` for ${approval.title}` : "");
    return {
      approvalId: item.approvalId,
      priority: item.priority,
      reason: reason.slice(0, 500),
    };
  });

  const recommendedNextAction =
    topTitle == null
      ? "No approvals require action."
      : `Review ${topTitle} first.`.slice(0, 500);

  return {
    overview: overview.slice(0, 2000),
    priorityItems,
    recommendedNextAction,
  };
}
