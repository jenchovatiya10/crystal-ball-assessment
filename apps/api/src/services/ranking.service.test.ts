import type { Approval } from "@crystal-ball/shared";
import { APPROVALS } from "../fixtures/approvals.js";
import { rankApprovals } from "./ranking.service.js";

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

/** Fixed clock for deterministic ranking assertions. */
const NOW = new Date("2026-09-30T12:00:00.000Z");

describe("rankApprovals", () => {
  it("ranks overdue approvals above non-overdue", () => {
    const overdue = makeApproval({
      id: "apr_overdue",
      dueAt: "2026-09-29T17:00:00.000Z",
      type: "image",
      flags: [],
    });
    const onTime = makeApproval({
      id: "apr_on_time",
      dueAt: "2026-10-20T17:00:00.000Z",
      type: "pdf",
      flags: ["safety"],
    });

    const ranked = rankApprovals([onTime, overdue], NOW);

    expect(ranked[0]?.approvalId).toBe("apr_overdue");
    expect(ranked[1]?.approvalId).toBe("apr_on_time");
    expect(ranked[0]?.factors.overdue).toBe(true);
    expect(ranked[1]?.factors.overdue).toBe(false);
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });

  it("ranks due-soon approvals above later-due items of the same type", () => {
    const dueSoon = makeApproval({
      id: "apr_due_soon",
      dueAt: "2026-10-01T12:00:00.000Z", // 24h from NOW
      type: "folder",
      flags: [],
    });
    const later = makeApproval({
      id: "apr_later",
      dueAt: "2026-10-20T17:00:00.000Z",
      type: "folder",
      flags: [],
    });

    const ranked = rankApprovals([later, dueSoon], NOW);

    expect(ranked[0]?.approvalId).toBe("apr_due_soon");
    expect(ranked[1]?.approvalId).toBe("apr_later");
    expect(ranked[0]?.factors.dueSoon).toBe(true);
    expect(ranked[1]?.factors.dueSoon).toBe(false);
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });

  it("increases urgency when important flags are present", () => {
    const withSafety = makeApproval({
      id: "apr_flagged",
      dueAt: "2026-10-15T17:00:00.000Z",
      type: "pdf",
      flags: ["safety"],
    });
    const plain = makeApproval({
      id: "apr_plain",
      dueAt: "2026-10-15T17:00:00.000Z",
      type: "pdf",
      flags: [],
    });

    const ranked = rankApprovals([plain, withSafety], NOW);

    expect(ranked[0]?.approvalId).toBe("apr_flagged");
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
    expect(ranked[0]!.factors.flagWeight).toBeGreaterThan(
      ranked[1]!.factors.flagWeight,
    );
    expect(ranked[0]?.reasons.some((r) => /safety/i.test(r))).toBe(true);
  });

  it("uses deterministic tie-break ordering when scores are equal", () => {
    const a = makeApproval({
      id: "apr_tie_b",
      dueAt: "2026-10-15T17:00:00.000Z",
      type: "image",
      flags: [],
    });
    const b = makeApproval({
      id: "apr_tie_a",
      dueAt: "2026-10-15T17:00:00.000Z",
      type: "image",
      flags: [],
    });

    const first = rankApprovals([a, b], NOW).map((r) => r.approvalId);
    const second = rankApprovals([b, a], NOW).map((r) => r.approvalId);

    expect(first).toEqual(second);
    expect(first).toEqual(["apr_tie_a", "apr_tie_b"]);
  });

  it("includes every fixture approval id exactly once", () => {
    const ranked = rankApprovals(APPROVALS, NOW);
    const rankedIds = ranked.map((r) => r.approvalId).sort();
    const fixtureIds = APPROVALS.map((a) => a.id).sort();

    expect(rankedIds).toEqual(fixtureIds);
    expect(new Set(rankedIds).size).toBe(APPROVALS.length);
  });

  it("does not mutate the original fixture objects", () => {
    const snapshot = structuredClone(APPROVALS);
    const input = [...APPROVALS];

    rankApprovals(input, NOW);

    expect(input).toEqual(APPROVALS);
    expect(APPROVALS).toEqual(snapshot);
    for (let i = 0; i < APPROVALS.length; i += 1) {
      expect(APPROVALS[i]).toEqual(snapshot[i]);
    }
  });

  it("retains original approval ids and explainable metadata on every result", () => {
    const ranked = rankApprovals(APPROVALS, NOW);

    for (const item of ranked) {
      expect(typeof item.approvalId).toBe("string");
      expect(item.approvalId.length).toBeGreaterThan(0);
      expect(typeof item.score).toBe("number");
      expect(["critical", "high", "medium", "low"]).toContain(item.priority);
      expect(Array.isArray(item.reasons)).toBe(true);
      expect(item.reasons.length).toBeGreaterThan(0);
      expect(item.factors).toEqual(
        expect.objectContaining({
          overdue: expect.any(Boolean),
          dueSoon: expect.any(Boolean),
          typeWeight: expect.any(Number),
          flagWeight: expect.any(Number),
        }),
      );
    }
  });
});
