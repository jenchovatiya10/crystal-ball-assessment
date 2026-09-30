import { randomUUID } from "node:crypto";
import {
  HelpResponseSchema,
  SummaryResponseSchema,
} from "@crystal-ball/shared";
import request from "supertest";
import { FakeAIProvider } from "../ai/FakeAIProvider.js";
import { AITimeoutError } from "../ai/resilience.js";
import { createApp, type AppDeps } from "../app.js";
import { APPROVALS } from "../fixtures/approvals.js";
import { rankApprovals } from "../services/ranking.service.js";

const NOW = new Date("2026-09-30T12:00:00.000Z");
const fixedClock = { now: () => NOW };

function validSummaryPayload() {
  const ranked = rankApprovals(APPROVALS, NOW);
  return {
    overview:
      "You have a focused approval queue. Items are listed in the supplied ranking order for review.",
    priorityItems: ranked.map((item) => ({
      approvalId: item.approvalId,
      priority: item.priority,
      reason: item.reasons[0] ?? "Ranked by deterministic scoring",
    })),
    recommendedNextAction: "Review the top ranked approval first.",
  };
}

function testApp(
  provider: FakeAIProvider,
  rateLimitMax = 50,
) {
  const deps: AppDeps = {
    provider,
    clock: fixedClock,
    approvals: APPROVALS,
  };
  return createApp(deps, {
    webOrigin: "http://localhost:3000",
    rateLimitWindowMs: 60_000,
    rateLimitMax,
  });
}

describe("assistant HTTP API", () => {
  it("GET /api/approvals returns 200 with seeded approvals", async () => {
    const app = testApp(new FakeAIProvider({ structuredResponse: validSummaryPayload() }));
    const response = await request(app).get("/api/approvals");

    expect(response.status).toBe(200);
    expect(response.body.approvals).toHaveLength(APPROVALS.length);
    expect(response.body.approvals[0]).toHaveProperty("id");
  });

  it("POST /api/assistant/summary returns AI summary success", async () => {
    const payload = validSummaryPayload();
    const app = testApp(new FakeAIProvider({ structuredResponse: payload }));
    const sessionId = randomUUID();

    const response = await request(app)
      .post("/api/assistant/summary")
      .set("X-Session-Id", sessionId)
      .send({ language: "en" });

    expect(response.status).toBe(200);
    expect(SummaryResponseSchema.safeParse(response.body.data).success).toBe(
      true,
    );
    expect(response.body.meta.source).toBe("ai");
    expect(response.body.meta.promptVersion).toBe("summary.v1");
  });

  it("POST /api/assistant/summary rejects invalid body", async () => {
    const app = testApp(new FakeAIProvider({ structuredResponse: validSummaryPayload() }));
    const response = await request(app)
      .post("/api/assistant/summary")
      .set("X-Session-Id", randomUUID())
      .send({ language: "fr" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("BAD_REQUEST");
  });

  it("POST /api/assistant/summary returns fallback meta on AI timeout", async () => {
    const app = testApp(
      new FakeAIProvider({ error: new AITimeoutError() }),
    );

    const response = await request(app)
      .post("/api/assistant/summary")
      .set("X-Session-Id", randomUUID())
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.meta.source).toBe("fallback");
    expect(response.body.meta.reason).toBe("timeout");
    expect(SummaryResponseSchema.safeParse(response.body.data).success).toBe(
      true,
    );
  });

  it("POST /api/assistant/help returns grounded success", async () => {
    const provider = new FakeAIProvider({
      structuredResponse: {
        answer:
          "Escalate blocked approvals to the duty supervisor within one business day per policy.",
        sources: ["policy-03"],
        grounded: true,
      },
    });
    provider.generateStructured = async (params) => {
      const input = params.input as { chunks?: Array<{ id: string }> };
      const ids = (input.chunks ?? []).map((c) => c.id);
      return params.schema.parse({
        answer:
          "Escalate blocked approvals to the duty supervisor within one business day per policy.",
        sources: ids.length > 0 ? ids : ["policy-03"],
        grounded: true,
      });
    };

    const response = await request(
      createApp(
        { provider, clock: fixedClock, approvals: APPROVALS },
        { webOrigin: "http://localhost:3000", rateLimitMax: 50 },
      ),
    )
      .post("/api/assistant/help")
      .set("X-Session-Id", randomUUID())
      .send({
        question: "How do I escalate blocked approvals?",
        language: "en",
      });

    expect(response.status).toBe(200);
    expect(HelpResponseSchema.safeParse(response.body.data).success).toBe(true);
    expect(response.body.data.grounded).toBe(true);
    expect(response.body.meta.source).toBe("ai");
  });

  it("POST /api/assistant/help returns no-answer without calling inventing sources", async () => {
    let calls = 0;
    const provider = new FakeAIProvider({
      structuredResponse: {
        answer: "should not be used",
        sources: ["policy-01"],
        grounded: true,
      },
    });
    const original = provider.generateStructured.bind(provider);
    provider.generateStructured = async (params) => {
      calls += 1;
      return original(params);
    };

    const response = await request(
      createApp(
        { provider, clock: fixedClock, approvals: APPROVALS },
        { webOrigin: "http://localhost:3000", rateLimitMax: 50 },
      ),
    )
      .post("/api/assistant/help")
      .set("X-Session-Id", randomUUID())
      .send({ question: "quantum culinary blockchain recipes unrelated" });

    expect(response.status).toBe(200);
    expect(calls).toBe(0);
    expect(response.body.data.grounded).toBe(false);
    expect(response.body.data.sources).toEqual([]);
    expect(response.body.meta.reason).toBe("no_sources");
  });

  it("GET /api/assistant/greeting returns greeting payload", async () => {
    const app = testApp(new FakeAIProvider({ structuredResponse: validSummaryPayload() }));
    const response = await request(app)
      .get("/api/assistant/greeting")
      .query({ language: "en" })
      .set("X-Session-Id", randomUUID());

    expect(response.status).toBe(200);
    expect(response.body.greeting).toEqual(expect.any(String));
    expect(response.body.greeting.length).toBeGreaterThan(0);
    expect(response.body.meta).toEqual(
      expect.objectContaining({
        dayPart: expect.any(String),
        totalCount: APPROVALS.length,
      }),
    );
  });

  it("POST /api/assistant/chat rejects invalid body", async () => {
    const app = testApp(
      new FakeAIProvider({ streamTokens: ["hi"] }),
    );
    const response = await request(app)
      .post("/api/assistant/chat")
      .set("X-Session-Id", randomUUID())
      .send({ sessionId: randomUUID() });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("BAD_REQUEST");
  });

  it("rate limits assistant AI routes with 429 Retry-After", async () => {
    const app = testApp(
      new FakeAIProvider({ structuredResponse: validSummaryPayload() }),
      1,
    );
    const sessionId = randomUUID();

    await request(app)
      .post("/api/assistant/summary")
      .set("X-Session-Id", sessionId)
      .send({})
      .expect(200);

    const limited = await request(app)
      .post("/api/assistant/summary")
      .set("X-Session-Id", sessionId)
      .send({});

    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBeTruthy();
    expect(limited.body.error.code).toBe("RATE_LIMITED");
  });
});
