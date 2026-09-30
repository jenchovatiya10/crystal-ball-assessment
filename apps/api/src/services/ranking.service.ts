import type { Approval, ApprovalType, Priority } from "@crystal-ball/shared";

/** Hours before dueAt that count as "due soon" (exclusive of overdue). */
const DUE_SOON_HOURS = 48;

const OVERDUE_SCORE = 100;
const DUE_SOON_SCORE = 40;

const TYPE_WEIGHTS: Record<ApprovalType, number> = {
  pdf: 15,
  folder: 10,
  video: 8,
  image: 5,
};

/** Only explicitly important flags add urgency; unknown flags are ignored. */
const FLAG_WEIGHTS: Readonly<Record<string, number>> = {
  safety: 25,
  checklist: 15,
  onboarding: 10,
  sensors: 10,
};

export type RankingFactors = {
  overdue: boolean;
  dueSoon: boolean;
  typeWeight: number;
  flagWeight: number;
};

export type RankedApproval = {
  approvalId: string;
  score: number;
  priority: Priority;
  reasons: string[];
  factors: RankingFactors;
};

function typeWeight(type: ApprovalType): number {
  return TYPE_WEIGHTS[type];
}

function flagWeight(flags: readonly string[]): number {
  return flags.reduce((sum, flag) => sum + (FLAG_WEIGHTS[flag] ?? 0), 0);
}

function toPriority(score: number): Priority {
  if (score >= 100) return "critical";
  if (score >= 55) return "high";
  if (score >= 30) return "medium";
  return "low";
}

function buildReasons(
  approval: Approval,
  factors: RankingFactors,
): string[] {
  const reasons: string[] = [];

  if (factors.overdue) {
    reasons.push(`Overdue (due ${approval.dueAt})`);
  } else if (factors.dueSoon) {
    reasons.push(`Due within ${DUE_SOON_HOURS} hours (due ${approval.dueAt})`);
  } else {
    reasons.push(`Due later (${approval.dueAt})`);
  }

  reasons.push(`Type weight ${factors.typeWeight} for ${approval.type}`);

  if (factors.flagWeight > 0) {
    const important = approval.flags.filter((f) => FLAG_WEIGHTS[f] != null);
    reasons.push(
      `Important flags (+${factors.flagWeight}): ${important.join(", ")}`,
    );
  } else {
    reasons.push("No important urgency flags");
  }

  return reasons;
}

function scoreApproval(approval: Approval, now: Date): RankedApproval {
  const dueAtMs = Date.parse(approval.dueAt);
  const nowMs = now.getTime();
  const overdue = dueAtMs < nowMs;
  const dueSoon =
    !overdue && dueAtMs - nowMs <= DUE_SOON_HOURS * 60 * 60 * 1000;

  const type = typeWeight(approval.type);
  const flags = flagWeight(approval.flags);

  const factors: RankingFactors = {
    overdue,
    dueSoon,
    typeWeight: type,
    flagWeight: flags,
  };

  const score =
    (overdue ? OVERDUE_SCORE : 0) +
    (dueSoon ? DUE_SOON_SCORE : 0) +
    type +
    flags;

  return {
    approvalId: approval.id,
    score,
    priority: toPriority(score),
    reasons: buildReasons(approval, factors),
    factors,
  };
}

/**
 * Deterministic, LLM-free approval ranking.
 *
 * score = overdue(100) + dueSoon(40) + typeWeight + flagWeight
 * Sort: score DESC, then approvalId ASC (stable tie-break).
 */
export function rankApprovals(
  approvals: readonly Approval[],
  now: Date = new Date(),
): RankedApproval[] {
  return approvals
    .map((approval) => scoreApproval(approval, now))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.approvalId.localeCompare(b.approvalId);
    });
}
