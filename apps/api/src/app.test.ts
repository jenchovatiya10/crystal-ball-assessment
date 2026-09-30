import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { z } from "zod";
import { FakeAIProvider } from "./ai/FakeAIProvider.js";
import { createApp, type AppDeps } from "./app.js";
import { EnvSchema, loadEnv } from "./config/env.js";
import { APPROVALS } from "./fixtures/approvals.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requestIdMiddleware } from "./middleware/requestId.js";
import { validate } from "./middleware/validate.js";

const fixedClock = { now: () => new Date("2026-09-30T12:00:00.000Z") };

function testDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
    provider: new FakeAIProvider({
      structuredResponse: { answer: "x", score: 1 },
    }),
    clock: fixedClock,
    approvals: APPROVALS,
    ...overrides,
  };
}

function testApp(rateLimitMax = 30) {
  return createApp(testDeps(), {
    webOrigin: "http://localhost:3000",
    rateLimitWindowMs: 60_000,
    rateLimitMax,
  });
}

describe("createApp foundation", () => {
  it("returns health ok", async () => {
    const app = testApp();
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it("returns generic 404 error envelope with requestId", async () => {
    const app = testApp();
    const response = await request(app)
      .get("/api/missing")
      .set("X-Request-Id", "req-test-404");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Resource not found",
        requestId: "req-test-404",
      },
    });
    expect(response.headers["x-request-id"]).toBe("req-test-404");
    expect(JSON.stringify(response.body)).not.toMatch(
      /stack|anthropic|api[_-]?key/i,
    );
  });

  it("rejects invalid X-Session-Id", async () => {
    const app = testApp();
    const response = await request(app)
      .get("/api/__middleware_probe__")
      .set("X-Session-Id", "not-a-uuid");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_SESSION_ID");
    expect(response.body.error.requestId).toBeTruthy();
  });

  it("accepts a valid X-Session-Id UUID", async () => {
    const app = testApp();
    const sessionId = randomUUID();
    const response = await request(app)
      .get("/api/__middleware_probe__")
      .set("X-Session-Id", sessionId);

    expect(response.status).toBe(200);
    expect(response.body.sessionId).toBe(sessionId);
  });

  it("rate limits by X-Session-Id and returns 429 with Retry-After", async () => {
    const app = testApp(2);
    const sessionId = randomUUID();

    await request(app)
      .get("/api/__middleware_probe__")
      .set("X-Session-Id", sessionId)
      .expect(200);
    await request(app)
      .get("/api/__middleware_probe__")
      .set("X-Session-Id", sessionId)
      .expect(200);

    const limited = await request(app)
      .get("/api/__middleware_probe__")
      .set("X-Session-Id", sessionId);

    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBeTruthy();
    expect(limited.body.error.code).toBe("RATE_LIMITED");
    expect(limited.body.error.requestId).toBeTruthy();
  });

  it("does not share rate-limit budget across different session IDs", async () => {
    const app = testApp(1);
    const a = randomUUID();
    const b = randomUUID();

    await request(app)
      .get("/api/__middleware_probe__")
      .set("X-Session-Id", a)
      .expect(200);
    await request(app)
      .get("/api/__middleware_probe__")
      .set("X-Session-Id", b)
      .expect(200);
  });

  it("rejects oversized JSON bodies with a generic envelope", async () => {
    const expressApp = express();
    expressApp.use(requestIdMiddleware);
    expressApp.use(express.json({ limit: "1kb" }));
    expressApp.post("/probe", (_req, res) => {
      res.json({ ok: true });
    });
    expressApp.use(errorHandler);

    const huge = "x".repeat(2048);
    const response = await request(expressApp)
      .post("/probe")
      .set("Content-Type", "application/json")
      .send({ payload: huge });

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(response.body.error.requestId).toBeTruthy();
    expect(JSON.stringify(response.body)).not.toMatch(/stack/i);
  });

  it("sets security headers via helmet", async () => {
    const app = testApp();
    const response = await request(app).get("/api/health");
    expect(response.headers["x-powered-by"]).toBeUndefined();
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe("validate middleware", () => {
  it("rejects invalid payloads with generic error shape", async () => {
    const mini = express();
    mini.use(requestIdMiddleware);
    mini.use(express.json());
    mini.post(
      "/probe",
      validate(z.object({ name: z.string().min(1) })),
      (_req, res) => {
        res.json({ ok: true });
      },
    );
    mini.use(errorHandler);

    const response = await request(mini).post("/probe").send({ name: "" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: "BAD_REQUEST",
        message: "Request validation failed",
        requestId: expect.any(String),
      },
    });
  });
});

describe("loadEnv", () => {
  it("parses required server env vars", () => {
    const env = loadEnv({
      ANTHROPIC_API_KEY: "sk-test",
      ANTHROPIC_MODEL: "claude-test",
      WEB_ORIGIN: "http://localhost:3000",
      API_PORT: "3001",
    });

    expect(env).toEqual({
      ANTHROPIC_API_KEY: "sk-test",
      ANTHROPIC_MODEL: "claude-test",
      WEB_ORIGIN: "http://localhost:3000",
      API_PORT: 3001,
    });
  });

  it("allows omitting Anthropic key for local fallback mode", () => {
    const env = loadEnv({
      ANTHROPIC_API_KEY: "",
      WEB_ORIGIN: "http://localhost:3000",
    });

    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_MODEL).toBe("claude-sonnet-4-20250514");
    expect(env.WEB_ORIGIN).toBe("http://localhost:3000");
  });

  it("fails when WEB_ORIGIN is missing", () => {
    expect(() =>
      loadEnv({
        ANTHROPIC_API_KEY: "sk-test",
        ANTHROPIC_MODEL: "claude-test",
      }),
    ).toThrow(/WEB_ORIGIN/);
  });

  it("keeps secrets server-side only (no NEXT_PUBLIC in EnvSchema)", () => {
    expect(Object.keys(EnvSchema.shape)).toEqual(
      expect.arrayContaining([
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_MODEL",
        "WEB_ORIGIN",
        "API_PORT",
      ]),
    );
    expect(Object.keys(EnvSchema.shape)).not.toContain("NEXT_PUBLIC_API_URL");
  });
});
