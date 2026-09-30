import { z } from "zod";
import { FakeAIProvider } from "./FakeAIProvider.js";

const SampleSchema = z.object({
  answer: z.string().min(1),
  score: z.number().int(),
});

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const chunk of stream) {
    out.push(chunk);
  }
  return out;
}

describe("FakeAIProvider", () => {
  it("returns a successful structured response parsed by the schema", async () => {
    const provider = new FakeAIProvider({
      structuredResponse: { answer: "ok", score: 3 },
    });

    const result = await provider.generateStructured({
      prompt: "test-prompt",
      input: { q: "hello" },
      schema: SampleSchema,
    });

    expect(result).toEqual({ answer: "ok", score: 3 });
  });

  it("rejects an invalid structured response via Zod", async () => {
    const provider = new FakeAIProvider({
      invalidStructuredResponse: { answer: "", score: "nope" },
    });

    await expect(
      provider.generateStructured({
        prompt: "test-prompt",
        input: {},
        schema: SampleSchema,
      }),
    ).rejects.toThrow();
  });

  it("delays structured responses when delayMs is set", async () => {
    const provider = new FakeAIProvider({
      structuredResponse: { answer: "slow", score: 1 },
      delayMs: 40,
    });

    const started = Date.now();
    await provider.generateStructured({
      prompt: "p",
      input: {},
      schema: SampleSchema,
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(35);
  });

  it("throws a configured error from generateStructured", async () => {
    const provider = new FakeAIProvider({
      error: new Error("boom"),
      structuredResponse: { answer: "unused", score: 1 },
    });

    await expect(
      provider.generateStructured({
        prompt: "p",
        input: {},
        schema: SampleSchema,
      }),
    ).rejects.toThrow("boom");
  });

  it("streams configured tokens", async () => {
    const provider = new FakeAIProvider({
      streamTokens: ["Hel", "lo", "!"],
    });

    const tokens = await collect(
      provider.stream({
        prompt: "p",
        messages: [{ role: "user", content: "hi" }],
      }),
    );

    expect(tokens).toEqual(["Hel", "lo", "!"]);
  });

  it("fails mid-stream after yielding tokens", async () => {
    const provider = new FakeAIProvider({
      streamTokens: ["a", "b", "c"],
      streamFailAfter: 2,
      streamError: new Error("stream-broke"),
    });

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
    ).rejects.toThrow("stream-broke");

    expect(seen).toEqual(["a", "b"]);
  });

  it("aborts a delayed structured call when the signal fires", async () => {
    const provider = new FakeAIProvider({
      structuredResponse: { answer: "late", score: 1 },
      delayMs: 200,
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);

    await expect(
      provider.generateStructured({
        prompt: "p",
        input: {},
        schema: SampleSchema,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("consumes queued structured responses in order", async () => {
    const provider = new FakeAIProvider({
      structuredResponses: [
        { answer: "one", score: 1 },
        { answer: "two", score: 2 },
      ],
    });

    const first = await provider.generateStructured({
      prompt: "p",
      input: {},
      schema: SampleSchema,
    });
    const second = await provider.generateStructured({
      prompt: "p",
      input: {},
      schema: SampleSchema,
    });

    expect(first.answer).toBe("one");
    expect(second.answer).toBe("two");
  });
});
