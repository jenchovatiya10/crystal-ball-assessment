import type { Approval, Priority } from "@crystal-ball/shared";
import { rankApprovals } from "./ranking.service.js";

export type Clock = {
  now: () => Date;
};

export type GreetingLanguage = "en" | "es";

export type DayPart = "morning" | "afternoon" | "evening";

export type UrgencyBreakdown = Record<Priority, number>;

export type GreetingResult = {
  message: string;
  dayPart: DayPart;
  totalCount: number;
  urgency: UrgencyBreakdown;
  highestPriorityApprovalId: string | null;
  highestPriorityTitle: string | null;
};

export type BuildGreetingOptions = {
  clock?: Clock;
  language?: GreetingLanguage;
};

const systemClock: Clock = {
  now: () => new Date(),
};

function dayPartFromHour(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  return "evening";
}

function emptyUrgency(): UrgencyBreakdown {
  return { critical: 0, high: 0, medium: 0, low: 0 };
}

function countUrgency(
  ranked: ReturnType<typeof rankApprovals>,
): UrgencyBreakdown {
  const urgency = emptyUrgency();
  for (const item of ranked) {
    urgency[item.priority] += 1;
  }
  return urgency;
}

function greetingPhrase(dayPart: DayPart, language: GreetingLanguage): string {
  if (language === "es") {
    if (dayPart === "morning") return "Buenos días.";
    if (dayPart === "afternoon") return "Buenas tardes.";
    return "Buenas noches.";
  }
  if (dayPart === "morning") return "Good morning.";
  if (dayPart === "afternoon") return "Good afternoon.";
  return "Good evening.";
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

function urgencyPhrase(
  urgency: UrgencyBreakdown,
  language: GreetingLanguage,
): string | null {
  const ordered: Priority[] = ["critical", "high", "medium", "low"];
  for (const level of ordered) {
    const count = urgency[level];
    if (count <= 0) continue;
    if (language === "es") {
      return `Incluye ${count} ${pluralize(count, "elemento", "elementos")} ${level}.`;
    }
    return `Including ${count} ${level} ${pluralize(count, "item", "items")}.`;
  }
  return null;
}

function queuePhrase(count: number, language: GreetingLanguage): string {
  if (language === "es") {
    if (count === 0) return "No hay aprobaciones en espera.";
    return `Tienes ${count} ${pluralize(count, "aprobación", "aprobaciones")} en espera.`;
  }
  if (count === 0) return "You have no approvals waiting.";
  return `You have ${count} ${pluralize(count, "approval", "approvals")} waiting.`;
}

function attentionPhrase(title: string, language: GreetingLanguage): string {
  if (language === "es") {
    return `La ${title} necesita tu atención primero.`;
  }
  return `The ${title} needs your attention first.`;
}

/**
 * Deterministic Replay Greeting — assembled from live approvals + clock.
 * Never calls an LLM.
 */
export function buildGreeting(
  approvals: readonly Approval[],
  options: BuildGreetingOptions = {},
): GreetingResult {
  const clock = options.clock ?? systemClock;
  const language = options.language ?? "en";
  const now = clock.now();
  const dayPart = dayPartFromHour(now.getUTCHours());

  const ranked = rankApprovals(approvals, now);
  const urgency = countUrgency(ranked);
  const totalCount = approvals.length;

  const top = ranked[0] ?? null;
  const highestPriorityApprovalId = top?.approvalId ?? null;
  const highestPriorityTitle =
    highestPriorityApprovalId == null
      ? null
      : (approvals.find((a) => a.id === highestPriorityApprovalId)?.title ??
        null);

  const parts: string[] = [greetingPhrase(dayPart, language)];
  parts.push(queuePhrase(totalCount, language));

  if (totalCount > 0) {
    const urgencyText = urgencyPhrase(urgency, language);
    if (urgencyText) parts.push(urgencyText);
    if (highestPriorityTitle) {
      parts.push(attentionPhrase(highestPriorityTitle, language));
    }
  }

  return {
    message: parts.join(" "),
    dayPart,
    totalCount,
    urgency,
    highestPriorityApprovalId,
    highestPriorityTitle,
  };
}
