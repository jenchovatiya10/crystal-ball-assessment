import type { Approval } from "@crystal-ball/shared";
import { APPROVALS } from "../fixtures/approvals.js";
import { buildGreeting, type Clock } from "./greeting.service.js";

function fixedClock(iso: string): Clock {
  return { now: () => new Date(iso) };
}

function makeApproval(overrides: Partial<Approval> & Pick<Approval, "id">): Approval {
  return {
    title: "Test Approval",
    type: "pdf",
    submittedAt: "2026-09-01T00:00:00.000Z",
    dueAt: "2026-10-15T17:00:00.000Z",
    flags: [],
    ...overrides,
  };
}

describe("buildGreeting", () => {
  it("uses a morning greeting for morning hours", () => {
    const result = buildGreeting(APPROVALS, {
      clock: fixedClock("2026-09-30T08:00:00.000Z"),
      language: "en",
    });

    expect(result.dayPart).toBe("morning");
    expect(result.message.startsWith("Good morning.")).toBe(true);
  });

  it("uses afternoon and evening greetings for later dayparts", () => {
    const afternoon = buildGreeting(APPROVALS, {
      clock: fixedClock("2026-09-30T14:00:00.000Z"),
      language: "en",
    });
    const evening = buildGreeting(APPROVALS, {
      clock: fixedClock("2026-09-30T19:30:00.000Z"),
      language: "en",
    });

    expect(afternoon.dayPart).toBe("afternoon");
    expect(afternoon.message.startsWith("Good afternoon.")).toBe(true);
    expect(evening.dayPart).toBe("evening");
    expect(evening.message.startsWith("Good evening.")).toBe(true);
  });

  it("handles an empty queue without inventing a highest-priority item", () => {
    const result = buildGreeting([], {
      clock: fixedClock("2026-09-30T08:00:00.000Z"),
      language: "en",
    });

    expect(result.totalCount).toBe(0);
    expect(result.highestPriorityApprovalId).toBeNull();
    expect(result.highestPriorityTitle).toBeNull();
    expect(result.message).toContain("no approvals waiting");
    expect(result.message).not.toMatch(/needs your attention first/i);
  });

  it("reports a normal queue count from live approvals", () => {
    const result = buildGreeting(APPROVALS, {
      clock: fixedClock("2026-09-30T08:00:00.000Z"),
      language: "en",
    });

    expect(result.totalCount).toBe(4);
    expect(result.message).toContain("4 approvals waiting");
  });

  it("includes the highest-priority item title from ranking", () => {
    const overdue = makeApproval({
      id: "apr_top",
      title: "Site Patrol Onboarding & Checklists Folder",
      dueAt: "2026-09-20T17:00:00.000Z",
      type: "folder",
      flags: ["checklist"],
    });
    const later = makeApproval({
      id: "apr_low",
      title: "Later Image",
      dueAt: "2026-10-20T17:00:00.000Z",
      type: "image",
      flags: [],
    });

    const result = buildGreeting([later, overdue], {
      clock: fixedClock("2026-09-30T08:00:00.000Z"),
      language: "en",
    });

    expect(result.highestPriorityApprovalId).toBe("apr_top");
    expect(result.highestPriorityTitle).toBe(
      "Site Patrol Onboarding & Checklists Folder",
    );
    expect(result.message).toContain(
      "Site Patrol Onboarding & Checklists Folder needs your attention first",
    );
  });

  it("includes an urgency breakdown derived from ranking", () => {
    const overdue = makeApproval({
      id: "apr_critical",
      title: "Overdue PDF",
      dueAt: "2026-09-01T00:00:00.000Z",
      type: "pdf",
      flags: ["safety"],
    });
    const later = makeApproval({
      id: "apr_low",
      title: "Later Image",
      dueAt: "2026-11-01T00:00:00.000Z",
      type: "image",
      flags: [],
    });

    const result = buildGreeting([overdue, later], {
      clock: fixedClock("2026-09-30T08:00:00.000Z"),
      language: "en",
    });

    expect(result.urgency.critical).toBeGreaterThanOrEqual(1);
    expect(result.urgency.low).toBeGreaterThanOrEqual(1);
    expect(result.message).toMatch(/critical/i);
  });

  it("is deterministic for the same approvals, clock, and language", () => {
    const clock = fixedClock("2026-09-30T08:00:00.000Z");
    const a = buildGreeting(APPROVALS, { clock, language: "en" });
    const b = buildGreeting(APPROVALS, { clock, language: "en" });

    expect(a).toEqual(b);
    expect(a.message).toBe(b.message);
  });

  it("supports Spanish greetings when language is es", () => {
    const result = buildGreeting(APPROVALS, {
      clock: fixedClock("2026-09-30T08:00:00.000Z"),
      language: "es",
    });

    expect(result.message.startsWith("Buenos días.")).toBe(true);
    expect(result.message).toContain("4 aprobaciones en espera");
  });
});
