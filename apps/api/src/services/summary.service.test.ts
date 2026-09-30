import {
  SummaryResponseSchema,
  type Approval,
  type SummaryResponse,
} from "@crystal-ball/shared";
import type { AIProvider } from "../ai/AIProvider.js";
import type { GenerateStructuredParams, StreamParams } from "../ai/types.js";
import {
  AITimeoutError,
  AIUnavailableError,
} from "../ai/resilience.js";
import { APPROVALS } from "../fixtures/approvals.js";
import { rankApprovals } from "./ranking.service.js";
import { SUMMARY_PROMPT_VERSION } from "../prompts/summary.v1.js";
import { SummaryService } from "./summary.service.js";

const NOW = new Date("2026-09-30T12:00:00.000Z");

function makeApproval(
  overrides: Partial<Approval> & Pick<Approval, "id" | "title">,
): Approval {
  return {
    type: "pdf",
    submittedAt: "2026-09-01T00:00:00.000Z",
    dueAt: "2026-10-15T17:00:00.000Z",
    flags: [],
    ...overrides,
  };
}

class ScriptedStructuredProvider implements AIProvider {
  calls = 0;
  lastPrompt = "";
  lastInput: unknown;

  constructor(private readonly responses: Array<unknown | Error>) {}

  async generateStructured<T>(
    params: GenerateStructuredParams<T>,
  ): Promise<T> {
    this.lastPrompt = params.prompt;
    this.lastInput = params.input;
    const step = this.responses[this.calls++];
    if (step instanceof Error) throw step;
    return params.schema.parse(step);
  }

  async *stream(_params: StreamParams): AsyncIterable<string> {
    yield "";
  }
}

function validAiSummary(approvals: readonly Approval[] = APPROVALS): SummaryResponse {
  const ranked = rankApprovals(approvals, NOW);
  return {
    overview:
      "You have a focused approval queue. Items are listed in the supplied ranking order.",
    priorityItems: ranked.map((item) => ({
      approvalId: item.approvalId,
      priority: item.priority,
      reason: item.reasons[0] ?? "Ranked by deterministic scoring",
    })),
    recommendedNextAction: `Review ${
      approvals.find((a) => a.id === ranked[0]?.approvalId)?.title ?? "the top item"
    } first.`,
  };
}

describe("SummaryService", () => {
  it("returns AI summary on success with source ai", async () => {
    const payload = validAiSummary();
    const ai = new ScriptedStructuredProvider([payload]);
    const service = new SummaryService(ai, { now: NOW, approvals: APPROVALS });

    const result = await service.presentSummary();

    expect(result.meta.source).toBe("ai");
    expect(result.meta.reason).toBeUndefined();
    expect(result.meta.promptVersion).toBe("summary.v1");
    expect(result.data).toEqual(payload);
    expect(SummaryResponseSchema.safeParse(result.data).success).toBe(true);
  });

  it("falls back on Zod-invalid AI output", async () => {
    const ai = new ScriptedStructuredProvider([
      {
        overview: "",
        priorityItems: [],
        recommendedNextAction: "",
      },
    ]);
    const service = new SummaryService(ai, { now: NOW, approvals: APPROVALS });

    const result = await service.presentSummary();

    expect(result.meta.source).toBe("fallback");
    expect(result.meta.reason).toBe("invalid_output");
    expect(SummaryResponseSchema.safeParse(result.data).success).toBe(true);
  });

  it("falls back when AI invents an invalid approval ID", async () => {
    const ranked = rankApprovals(APPROVALS, NOW);
    const bad: SummaryResponse = {
      overview: "Invented ranking should be rejected by semantic checks.",
      priorityItems: ranked.map((item, index) => ({
        approvalId: index === 0 ? "apr_does_not_exist" : item.approvalId,
        priority: item.priority,
        reason: "fabricated",
      })),
      recommendedNextAction: "Ignore invented ids.",
    };
    const ai = new ScriptedStructuredProvider([bad]);
    const service = new SummaryService(ai, { now: NOW, approvals: APPROVALS });

    const result = await service.presentSummary();

    expect(result.meta.source).toBe("fallback");
    expect(result.meta.reason).toBe("invalid_output");
    expect(
      result.data.priorityItems.every((item) =>
        APPROVALS.some((a) => a.id === item.approvalId),
      ),
    ).toBe(true);
  });

  it("falls back when AI priorities are inconsistent with ranking", async () => {
    const ranked = rankApprovals(APPROVALS, NOW);
    const inconsistent: SummaryResponse = {
      overview: "Model tried to reorder priorities.",
      priorityItems: ranked.map((item, index) => ({
        approvalId: item.approvalId,
        // Flip first item away from deterministic priority when possible
        priority: index === 0 ? (item.priority === "low" ? "critical" : "low") : item.priority,
        reason: "inconsistent",
      })),
      recommendedNextAction: "Should use fallback ranking.",
    };
    const ai = new ScriptedStructuredProvider([inconsistent]);
    const service = new SummaryService(ai, { now: NOW, approvals: APPROVALS });

    const result = await service.presentSummary();

    expect(result.meta.source).toBe("fallback");
    expect(result.meta.reason).toBe("invalid_output");

    const expectedOrder = ranked.map((r) => r.approvalId);
    expect(result.data.priorityItems.map((p) => p.approvalId)).toEqual(
      expectedOrder,
    );
    expect(result.data.priorityItems.map((p) => p.priority)).toEqual(
      ranked.map((r) => r.priority),
    );
  });

  it("falls back on timeout", async () => {
    const ai = new ScriptedStructuredProvider([new AITimeoutError()]);
    const service = new SummaryService(ai, { now: NOW, approvals: APPROVALS });

    const result = await service.presentSummary();

    expect(result.meta.source).toBe("fallback");
    expect(result.meta.reason).toBe("timeout");
    expect(SummaryResponseSchema.safeParse(result.data).success).toBe(true);
  });

  it("falls back when provider is unavailable", async () => {
    const ai = new ScriptedStructuredProvider([
      new AIUnavailableError("down", { retryable: false, status: 503 }),
    ]);
    const service = new SummaryService(ai, { now: NOW, approvals: APPROVALS });

    const result = await service.presentSummary();

    expect(result.meta.source).toBe("fallback");
    expect(result.meta.reason).toBe("unavailable");
  });

  it("includes fallback metadata and prompt version", async () => {
    const ai = new ScriptedStructuredProvider([new AITimeoutError()]);
    const service = new SummaryService(ai, { now: NOW, approvals: APPROVALS });

    const result = await service.presentSummary();

    expect(result.meta).toEqual({
      source: "fallback",
      reason: "timeout",
      promptVersion: SUMMARY_PROMPT_VERSION,
    });
    expect(result.meta.promptVersion).toBe("summary.v1");
  });

  it("uses summary.v1 prompt that forbids inventing ranking", async () => {
    const payload = validAiSummary();
    const ai = new ScriptedStructuredProvider([payload]);
    const service = new SummaryService(ai, { now: NOW, approvals: APPROVALS });

    await service.presentSummary();

    expect(ai.lastPrompt).toContain("summary.v1");
    expect(ai.lastPrompt.toLowerCase()).toMatch(/do not (invent|reorder|change).*(rank|order)/i);
    expect(ai.lastPrompt.toLowerCase()).toMatch(/explain/);
  });

  it("does not mutate the original fixture objects", async () => {
    const snapshot = structuredClone(APPROVALS);
    const ai = new ScriptedStructuredProvider([validAiSummary()]);
    const service = new SummaryService(ai, { now: NOW, approvals: APPROVALS });

    await service.presentSummary();

    expect(APPROVALS).toEqual(snapshot);
  });

  it("builds fallback from a small deterministic set without throwing", async () => {
    const approvals = [
      makeApproval({
        id: "apr_a",
        title: "Alpha Folder",
        type: "folder",
        dueAt: "2026-09-01T00:00:00.000Z",
        flags: ["checklist"],
      }),
      makeApproval({
        id: "apr_b",
        title: "Beta Image",
        type: "image",
        dueAt: "2026-11-01T00:00:00.000Z",
        flags: [],
      }),
    ];
    const ai = new ScriptedStructuredProvider([new AIUnavailableError("nope")]);
    const service = new SummaryService(ai, { now: NOW, approvals });

    const result = await service.presentSummary();

    expect(result.meta.source).toBe("fallback");
    expect(result.data.priorityItems).toHaveLength(2);
    expect(result.data.priorityItems[0]?.approvalId).toBe("apr_a");
  });

  it("SHOULD reuse a short in-memory summary cache for identical rankings", async () => {
    const payload = validAiSummary();
    const ai = new ScriptedStructuredProvider([payload, payload]);
    const service = new SummaryService(ai, {
      now: NOW,
      approvals: APPROVALS,
      cacheTtlMs: 60_000,
    });

    const first = await service.presentSummary();
    const second = await service.presentSummary();

    expect(first).toEqual(second);
    expect(ai.calls).toBe(1);
  });

  it("bypasses summary cache when TTL is disabled", async () => {
    const payload = validAiSummary();
    const ai = new ScriptedStructuredProvider([payload, payload]);
    const service = new SummaryService(ai, {
      now: NOW,
      approvals: APPROVALS,
      cacheTtlMs: 0,
    });

    await service.presentSummary();
    await service.presentSummary();

    expect(ai.calls).toBe(2);
  });
});
