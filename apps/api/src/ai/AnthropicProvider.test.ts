import { z } from "zod";
import {
  AnthropicProvider,
  STRUCTURED_TOOL_NAME,
  type AnthropicClientPort,
} from "./AnthropicProvider.js";
import {
  AIInvalidOutputError,
  AIUnavailableError,
} from "./resilience.js";

const SampleSchema = z.object({
  answer: z.string().min(1),
  score: z.number().int(),
});

type CreateCall = {
  body: {
    tools?: Array<{ name: string; input_schema: unknown }>;
    tool_choice?: { type: string; name: string };
    system?: string;
  };
  options?: { signal?: AbortSignal };
};

function mockClient(handlers: {
  create?: (
    body: CreateCall["body"],
    options?: { signal?: AbortSignal },
  ) => Promise<{
    content: Array<Record<string, unknown>>;
  }>;
  stream?: (
    body: unknown,
    options?: { signal?: AbortSignal },
  ) => AsyncIterable<Record<string, unknown>>;
}): { client: AnthropicClientPort; createCalls: CreateCall[] } {
  const createCalls: CreateCall[] = [];

  const client: AnthropicClientPort = {
    messages: {
      create: async (body, options) => {
        createCalls.push({ body: body as CreateCall["body"], options });
        if (!handlers.create) {
          throw new Error("create not stubbed");
        }
        return (await handlers.create(
          body as CreateCall["body"],
          options,
        )) as never;
      },
      stream: (body, options) => {
        if (!handlers.stream) {
          throw new Error("stream not stubbed");
        }
        return handlers.stream(body, options) as never;
      },
    },
  };

  return { client, createCalls };
}

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const chunk of stream) {
    out.push(chunk);
  }
  return out;
}

describe("AnthropicProvider", () => {
  it("requires a server API key when no client is injected", () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    expect(() => new AnthropicProvider()).toThrow(AIUnavailableError);

    if (previous !== undefined) {
      process.env.ANTHROPIC_API_KEY = previous;
    }
  });

  it("forces structured tool use and validates tool input with Zod", async () => {
    const { client, createCalls } = mockClient({
      create: async () => ({
        content: [
          {
            type: "tool_use",
            id: "tool_1",
            name: STRUCTURED_TOOL_NAME,
            input: { answer: "ok", score: 2 },
          },
        ],
      }),
    });

    const provider = new AnthropicProvider({
      client,
      apiKey: "test-key",
      model: "test-model",
    });

    const result = await provider.generateStructured({
      prompt: "versioned-prompt",
      input: { q: "hi" },
      schema: SampleSchema,
    });

    expect(result).toEqual({ answer: "ok", score: 2 });
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]?.body.tool_choice).toEqual({
      type: "tool",
      name: STRUCTURED_TOOL_NAME,
    });
    expect(createCalls[0]?.body.tools?.[0]?.name).toBe(STRUCTURED_TOOL_NAME);
    expect(createCalls[0]?.body.tools?.[0]?.input_schema).toEqual(
      expect.objectContaining({ type: "object" }),
    );
    expect(createCalls[0]?.body.system).toBe("versioned-prompt");
  });

  it("throws AIInvalidOutputError when tool input fails Zod", async () => {
    const { client } = mockClient({
      create: async () => ({
        content: [
          {
            type: "tool_use",
            id: "tool_1",
            name: STRUCTURED_TOOL_NAME,
            input: { answer: "", score: "nope" },
          },
        ],
      }),
    });

    const provider = new AnthropicProvider({ client, apiKey: "test-key" });

    await expect(
      provider.generateStructured({
        prompt: "p",
        input: {},
        schema: SampleSchema,
      }),
    ).rejects.toBeInstanceOf(AIInvalidOutputError);
  });

  it("throws AIInvalidOutputError when the structured tool block is missing", async () => {
    const { client } = mockClient({
      create: async () => ({
        content: [{ type: "text", text: '{"answer":"nope"}' }],
      }),
    });

    const provider = new AnthropicProvider({ client, apiKey: "test-key" });

    await expect(
      provider.generateStructured({
        prompt: "p",
        input: {},
        schema: SampleSchema,
      }),
    ).rejects.toBeInstanceOf(AIInvalidOutputError);
  });

  it("does not treat assistant text as structured JSON", async () => {
    const { client } = mockClient({
      create: async () => ({
        content: [
          {
            type: "text",
            text: '{"answer":"from-text","score":1}',
          },
        ],
      }),
    });

    const provider = new AnthropicProvider({ client, apiKey: "test-key" });

    await expect(
      provider.generateStructured({
        prompt: "p",
        input: {},
        schema: SampleSchema,
      }),
    ).rejects.toBeInstanceOf(AIInvalidOutputError);
  });

  it("yields only text delta chunks while streaming", async () => {
    const { client } = mockClient({
      stream: async function* () {
        yield {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Hel" },
        };
        yield {
          type: "content_block_delta",
          delta: { type: "input_json_delta", partial_json: "{" },
        };
        yield {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "lo" },
        };
        yield { type: "message_stop" };
      },
    });

    const provider = new AnthropicProvider({ client, apiKey: "test-key" });
    const tokens = await collect(
      provider.stream({
        prompt: "system",
        messages: [{ role: "user", content: "hi" }],
      }),
    );

    expect(tokens).toEqual(["Hel", "lo"]);
  });

  it("maps provider failures to AIUnavailableError", async () => {
    const { client } = mockClient({
      create: async () => {
        const err = new Error("upstream 503");
        throw err;
      },
    });

    const provider = new AnthropicProvider({ client, apiKey: "test-key" });

    await expect(
      provider.generateStructured({
        prompt: "p",
        input: {},
        schema: SampleSchema,
      }),
    ).rejects.toBeInstanceOf(AIUnavailableError);
  });

  it("respects an already-aborted AbortSignal", async () => {
    const { client } = mockClient({
      create: async () => ({
        content: [
          {
            type: "tool_use",
            name: STRUCTURED_TOOL_NAME,
            input: { answer: "x", score: 1 },
          },
        ],
      }),
    });
    const provider = new AnthropicProvider({ client, apiKey: "test-key" });
    const controller = new AbortController();
    controller.abort();

    await expect(
      provider.generateStructured({
        prompt: "p",
        input: {},
        schema: SampleSchema,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("forwards AbortSignal to the SDK create call", async () => {
    const controller = new AbortController();
    const { client, createCalls } = mockClient({
      create: async () => ({
        content: [
          {
            type: "tool_use",
            name: STRUCTURED_TOOL_NAME,
            input: { answer: "ok", score: 1 },
          },
        ],
      }),
    });

    const provider = new AnthropicProvider({ client, apiKey: "test-key" });
    await provider.generateStructured({
      prompt: "p",
      input: {},
      schema: SampleSchema,
      signal: controller.signal,
    });

    expect(createCalls[0]?.options?.signal).toBe(controller.signal);
  });
});
