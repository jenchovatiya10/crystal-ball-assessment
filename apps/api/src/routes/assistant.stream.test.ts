import { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import type { AIProvider } from "../ai/AIProvider.js";
import { FakeAIProvider } from "../ai/FakeAIProvider.js";
import { AIUnavailableError } from "../ai/resilience.js";
import type { GenerateStructuredParams, StreamParams } from "../ai/types.js";
import { createApp } from "../app.js";
import { APPROVALS } from "../fixtures/approvals.js";
import { ConversationStore } from "../services/conversationStore.js";

const fixedClock = { now: () => new Date("2026-09-30T12:00:00.000Z") };

type SseFrame = { event: string; data: Record<string, unknown> };

function parseSse(raw: string): SseFrame[] {
  return raw
    .split("\n\n")
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      let event = "message";
      const dataLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      return {
        event,
        data: JSON.parse(dataLines.join("\n") || "{}") as Record<
          string,
          unknown
        >,
      };
    });
}

function collectBody() {
  return (res: request.Response["res"], callback: (err: Error | null, body: string) => void) => {
    const data: Buffer[] = [];
    res.on("data", (chunk) => data.push(chunk as Buffer));
    res.on("end", () => callback(null, Buffer.concat(data).toString("utf8")));
  };
}

function testApp(provider: AIProvider, store?: ConversationStore) {
  return createApp(
    {
      provider,
      clock: fixedClock,
      approvals: APPROVALS,
      conversationStore: store,
    },
    { webOrigin: "http://localhost:3000", rateLimitMax: 100 },
  );
}

class ScriptedStreamProvider implements AIProvider {
  streamCalls = 0;

  constructor(
    private readonly script: Array<
      | { tokens: string[] }
      | { error: Error }
      | { tokens: string[]; failAfter: number; error: Error }
    >,
  ) {}

  async generateStructured<T>(
    _params: GenerateStructuredParams<T>,
  ): Promise<T> {
    throw new Error("unused");
  }

  async *stream(params: StreamParams): AsyncIterable<string> {
    const step =
      this.script[this.streamCalls++] ?? { error: new Error("no script") };
    if ("error" in step && !("tokens" in step)) {
      throw step.error;
    }
    if (params.signal?.aborted) {
      const err = new Error("Aborted");
      err.name = "AbortError";
      throw err;
    }
    const tokens = step.tokens;
    const failAfter = "failAfter" in step ? step.failAfter : undefined;
    for (let i = 0; i < tokens.length; i += 1) {
      if (params.signal?.aborted) {
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
      }
      if (failAfter != null && i >= failAfter) {
        throw step.error;
      }
      yield tokens[i]!;
      await new Promise((r) => setTimeout(r, 15));
    }
  }
}

describe("assistant SSE streaming", () => {
  it("emits meta first, then tokens, then done last for chat", async () => {
    const app = testApp(new FakeAIProvider({ streamTokens: ["Hel", "lo"] }));
    const sessionId = randomUUID();

    const response = await request(app)
      .post("/api/assistant/chat")
      .set("X-Session-Id", sessionId)
      .send({ sessionId, message: "Hello" })
      .buffer(true)
      .parse(collectBody());

    expect(response.headers["content-type"]).toMatch(/text\/event-stream/);
    expect(response.headers["cache-control"]).toMatch(/no-cache/);
    expect(response.headers["x-accel-buffering"]).toBe("no");

    const frames = parseSse(String(response.body));
    expect(frames[0]?.event).toBe("meta");
    expect(frames[0]?.data).toEqual(
      expect.objectContaining({
        sessionId,
        requestId: expect.any(String),
      }),
    );
    expect(frames.slice(1, -1).map((f) => f.event)).toEqual(["token", "token"]);
    expect(frames.slice(1, -1).map((f) => f.data)).toEqual([
      { t: "Hel" },
      { t: "lo" },
    ]);
    expect(frames.at(-1)?.event).toBe("done");
    expect(frames.at(-1)?.data).toEqual({});
  });

  it("emits the same SSE lifecycle for teach", async () => {
    const app = testApp(new FakeAIProvider({ streamTokens: ["A"] }));
    const sessionId = randomUUID();

    const response = await request(app)
      .post("/api/assistant/teach")
      .set("X-Session-Id", sessionId)
      .send({ sessionId, message: "Teach me PDF review" })
      .buffer(true)
      .parse(collectBody());

    const frames = parseSse(String(response.body));
    expect(frames.map((f) => f.event)).toEqual(["meta", "token", "done"]);
    expect(frames[1]?.data).toEqual({ t: "A" });
  });

  it("sends fallback token(s) and done when pre-first-token failures exhaust retries", async () => {
    const provider = new ScriptedStreamProvider([
      {
        error: new AIUnavailableError("fail-1", { retryable: true, status: 503 }),
      },
      {
        error: new AIUnavailableError("fail-2", { retryable: true, status: 503 }),
      },
    ]);
    const store = new ConversationStore();
    const app = testApp(provider, store);
    const sessionId = randomUUID();

    const response = await request(app)
      .post("/api/assistant/chat")
      .set("X-Session-Id", sessionId)
      .send({ sessionId, message: "Hello" })
      .buffer(true)
      .parse(collectBody());

    const frames = parseSse(String(response.body));
    expect(frames[0]?.event).toBe("meta");
    expect(provider.streamCalls).toBe(2);
    expect(frames.some((f) => f.event === "token")).toBe(true);
    expect(frames.at(-1)?.event).toBe("done");
    expect(frames.at(-1)?.data).toEqual({ fallback: true });
    expect(frames.some((f) => f.event === "error")).toBe(false);
    expect(store.getHistory(sessionId, "talk_to_me")).toHaveLength(2);
  });

  it("sends error SSE on mid-stream failure without retry", async () => {
    const provider = new ScriptedStreamProvider([
      {
        tokens: ["partial", "more"],
        failAfter: 1,
        error: new AIUnavailableError("mid", { retryable: true, status: 503 }),
      },
      { tokens: ["should-not-run"] },
    ]);
    const store = new ConversationStore();
    const app = testApp(provider, store);
    const sessionId = randomUUID();

    const response = await request(app)
      .post("/api/assistant/chat")
      .set("X-Session-Id", sessionId)
      .send({ sessionId, message: "Hello" })
      .buffer(true)
      .parse(collectBody());

    const frames = parseSse(String(response.body));
    expect(provider.streamCalls).toBe(1);
    expect(frames.map((f) => f.event)).toEqual(["meta", "token", "error"]);
    expect(frames[1]?.data).toEqual({ t: "partial" });
    expect(frames[2]?.data).toEqual(
      expect.objectContaining({
        code: expect.any(String),
        message: expect.any(String),
        fallback: true,
      }),
    );
    expect(store.getHistory(sessionId, "talk_to_me")).toEqual([]);
  });

  it("aborts provider work when the client closes the request", async () => {
    const provider = new ScriptedStreamProvider([
      { tokens: ["one", "two", "three", "four"] },
    ]);
    const store = new ConversationStore();
    const app = testApp(provider, store);
    const sessionId = randomUUID();

    await new Promise<void>((resolve, reject) => {
      const server = app.listen(0, () => {
        const { port } = server.address() as AddressInfo;
        let settled = false;
        const finish = (err?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          server.close(() => {
            if (err) reject(err);
            else resolve();
          });
        };
        const timer = setTimeout(() => {
          req.destroy();
          finish(new Error("abort test timed out"));
        }, 3000);
        timer.unref();

        const req = http.request(
          {
            hostname: "127.0.0.1",
            port,
            path: "/api/assistant/chat",
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Session-Id": sessionId,
            },
          },
          (res) => {
            let chunks = 0;
            res.on("data", () => {
              chunks += 1;
              if (chunks >= 2) {
                req.destroy();
              }
            });
            res.on("close", () => finish());
          },
        );
        req.on("error", () => finish());
        req.write(JSON.stringify({ sessionId, message: "abort please" }));
        req.end();
      });
    });

    expect(provider.streamCalls).toBeGreaterThanOrEqual(1);
    expect(store.getHistory(sessionId, "talk_to_me")).toEqual([]);
  });

  it("saves completed assistant response into session history", async () => {
    const store = new ConversationStore();
    const storeProbeProvider = new FakeAIProvider({
      streamTokens: ["Saved", " OK"],
    });
    const app = testApp(storeProbeProvider, store);
    const sessionId = randomUUID();

    await request(app)
      .post("/api/assistant/chat")
      .set("X-Session-Id", sessionId)
      .send({ sessionId, message: "Remember this" })
      .buffer(true)
      .parse(collectBody());

    expect(store.getHistory(sessionId, "talk_to_me")).toEqual([
      { role: "user", content: "Remember this" },
      { role: "assistant", content: "Saved OK" },
    ]);

    const seenMessages: unknown[] = [];
    const original = storeProbeProvider.stream.bind(storeProbeProvider);
    storeProbeProvider.stream = async function* (params) {
      seenMessages.push(params.messages);
      yield* original(params);
    };

    await request(app)
      .post("/api/assistant/chat")
      .set("X-Session-Id", sessionId)
      .send({ sessionId, message: "Follow up" })
      .buffer(true)
      .parse(collectBody());

    expect(seenMessages[0]).toEqual(
      expect.arrayContaining([
        { role: "user", content: "Remember this" },
        { role: "assistant", content: "Saved OK" },
        { role: "user", content: "Follow up" },
      ]),
    );
  });
});
