import { z } from "zod";
import type { AIProvider } from "./AIProvider.js";
import { FakeAIProvider } from "./FakeAIProvider.js";
import type { GenerateStructuredParams, StreamParams } from "./types.js";
import {
  AITimeoutError,
  AIUnavailableError,
  createResilientAIProvider,
} from "./resilience.js";

const SampleSchema = z.object({
  answer: z.string().min(1),
});

const baseStructured = {
  prompt: "p",
  input: {},
  schema: SampleSchema,
} as const;

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const chunk of stream) {
    out.push(chunk);
  }
  return out;
}

/** Scriptable inner provider for call-count and sequenced failures. */
class ScriptedProvider implements AIProvider {
  structuredCalls = 0;
  streamCalls = 0;

  constructor(
    private readonly script: {
      structured?: Array<"ok" | Error>;
      stream?: Array<"ok" | Error | { tokens: string[]; failAfter?: number }>;
    },
  ) {}

  async generateStructured<T>(
    params: GenerateStructuredParams<T>,
  ): Promise<T> {
    if (params.signal?.aborted) {
      const err = new Error("Aborted");
      err.name = "AbortError";
      throw err;
    }
    const step = this.script.structured?.[this.structuredCalls++];
    if (step instanceof Error) throw step;
    return params.schema.parse({ answer: "ok" });
  }

  async *stream(params: StreamParams): AsyncIterable<string> {
    if (params.signal?.aborted) {
      const err = new Error("Aborted");
      err.name = "AbortError";
      throw err;
    }
    const step = this.script.stream?.[this.streamCalls++];
    if (step instanceof Error) throw step;
    if (step === "ok" || step == null) {
      yield "hello";
      return;
    }
    const { tokens, failAfter } = step;
    for (let i = 0; i < tokens.length; i += 1) {
      if (failAfter != null && i >= failAfter) {
        throw new AIUnavailableError("mid-stream unavailable", {
          retryable: true,
          status: 503,
        });
      }
      yield tokens[i]!;
    }
  }
}

describe("createResilientAIProvider", () => {
  it("returns a successful structured call", async () => {
    const inner = new FakeAIProvider({
      structuredResponse: { answer: "done" },
    });
    const provider = createResilientAIProvider(inner, { timeoutMs: 200 });

    await expect(
      provider.generateStructured({ ...baseStructured }),
    ).resolves.toEqual({ answer: "done" });
  });

  it("times out slow calls as AITimeoutError", async () => {
    const inner = new FakeAIProvider({
      structuredResponse: { answer: "late" },
      delayMs: 80,
    });
    const provider = createResilientAIProvider(inner, { timeoutMs: 20 });

    await expect(
      provider.generateStructured({ ...baseStructured }),
    ).rejects.toBeInstanceOf(AITimeoutError);
  });

  it("does not retry timeouts", async () => {
    const delayed = new FakeAIProvider({
      structuredResponse: { answer: "late" },
      delayMs: 60,
    });
    const generateStructured = delayed.generateStructured.bind(delayed);
    let calls = 0;
    delayed.generateStructured = async (params) => {
      calls += 1;
      return generateStructured(params);
    };

    const provider = createResilientAIProvider(delayed, { timeoutMs: 15 });

    await expect(
      provider.generateStructured({ ...baseStructured }),
    ).rejects.toBeInstanceOf(AITimeoutError);
    expect(calls).toBe(1);
  });

  it("retries a transient error once and succeeds", async () => {
    const inner = new ScriptedProvider({
      structured: [
        new AIUnavailableError("503", { retryable: true, status: 503 }),
        "ok",
      ],
    });
    const provider = createResilientAIProvider(inner, { timeoutMs: 200 });

    await expect(
      provider.generateStructured({ ...baseStructured }),
    ).resolves.toEqual({ answer: "ok" });
    expect(inner.structuredCalls).toBe(2);
  });

  it("surfaces the second transient failure", async () => {
    const inner = new ScriptedProvider({
      structured: [
        new AIUnavailableError("503-a", { retryable: true, status: 503 }),
        new AIUnavailableError("503-b", { retryable: true, status: 503 }),
      ],
    });
    const provider = createResilientAIProvider(inner, { timeoutMs: 200 });

    await expect(
      provider.generateStructured({ ...baseStructured }),
    ).rejects.toMatchObject({
      name: "AIUnavailableError",
      message: "503-b",
    });
    expect(inner.structuredCalls).toBe(2);
  });

  it("stops execution when the caller aborts", async () => {
    const inner = new FakeAIProvider({
      structuredResponse: { answer: "late" },
      delayMs: 100,
    });
    const provider = createResilientAIProvider(inner, { timeoutMs: 500 });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 15);

    await expect(
      provider.generateStructured({
        ...baseStructured,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("retries streaming failures that occur before the first token", async () => {
    const inner = new ScriptedProvider({
      stream: [
        new AIUnavailableError("pre-token", { retryable: true, status: 502 }),
        { tokens: ["a", "b"] },
      ],
    });
    const provider = createResilientAIProvider(inner, { timeoutMs: 200 });

    await expect(
      collect(provider.stream({ prompt: "p", messages: [] })),
    ).resolves.toEqual(["a", "b"]);
    expect(inner.streamCalls).toBe(2);
  });

  it("does not automatically retry after streaming has emitted tokens", async () => {
    const inner = new ScriptedProvider({
      stream: [{ tokens: ["x", "y", "z"], failAfter: 1 }],
    });
    const provider = createResilientAIProvider(inner, { timeoutMs: 200 });

    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const token of provider.stream({
          prompt: "p",
          messages: [],
        })) {
          seen.push(token);
        }
      })(),
    ).rejects.toBeInstanceOf(AIUnavailableError);

    expect(seen).toEqual(["x"]);
    expect(inner.streamCalls).toBe(1);
  });
});
