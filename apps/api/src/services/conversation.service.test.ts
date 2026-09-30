import type { AIProvider } from "../ai/AIProvider.js";
import type { AIMessage, GenerateStructuredParams, StreamParams } from "../ai/types.js";
import { APPROVALS } from "../fixtures/approvals.js";
import {
  CHAT_PROMPT_VERSION,
  buildChatPrompt,
} from "../prompts/chat.v1.js";
import {
  TEACH_PROMPT_VERSION,
  buildTeachPrompt,
} from "../prompts/teach.v1.js";
import {
  ConversationStore,
  MAX_CONVERSATION_TURNS,
} from "./conversationStore.js";
import { ConversationService } from "./conversation.service.js";

class ScriptedStreamProvider implements AIProvider {
  streamCalls = 0;
  lastPrompt = "";
  lastMessages: AIMessage[] = [];
  lastSignal: AbortSignal | undefined;

  constructor(
    private readonly behavior:
      | { tokens: string[] }
      | { tokens: string[]; failAfter: number; error?: Error }
      | { error: Error },
  ) {}

  async generateStructured<T>(
    _params: GenerateStructuredParams<T>,
  ): Promise<T> {
    throw new Error("not used");
  }

  async *stream(params: StreamParams): AsyncIterable<string> {
    this.streamCalls += 1;
    this.lastPrompt = params.prompt;
    this.lastMessages = [...params.messages];
    this.lastSignal = params.signal;

    if ("error" in this.behavior && !("tokens" in this.behavior)) {
      throw this.behavior.error;
    }

    const tokens = this.behavior.tokens;
    const failAfter =
      "failAfter" in this.behavior ? this.behavior.failAfter : undefined;

    for (let i = 0; i < tokens.length; i += 1) {
      if (params.signal?.aborted) {
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
      }
      if (failAfter != null && i >= failAfter) {
        throw (
          ("error" in this.behavior && this.behavior.error) ||
          new Error("stream failed")
        );
      }
      yield tokens[i]!;
    }
  }
}

async function collect(
  stream: AsyncIterable<string>,
): Promise<string[]> {
  const out: string[] = [];
  for await (const chunk of stream) {
    out.push(chunk);
  }
  return out;
}

describe("ConversationStore", () => {
  it("starts a new session with empty history", () => {
    const store = new ConversationStore();
    expect(store.getHistory("sess-1", "talk_to_me")).toEqual([]);
  });

  it("retrieves appended history for a session/mode", () => {
    const store = new ConversationStore();
    store.append("sess-1", "talk_to_me", {
      role: "user",
      content: "hello",
    });
    store.append("sess-1", "talk_to_me", {
      role: "assistant",
      content: "hi",
    });

    expect(store.getHistory("sess-1", "talk_to_me")).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ]);
  });

  it("bounds history to the last 10 turns", () => {
    const store = new ConversationStore();
    expect(MAX_CONVERSATION_TURNS).toBe(10);

    for (let i = 0; i < 14; i += 1) {
      store.append("sess-1", "talk_to_me", {
        role: i % 2 === 0 ? "user" : "assistant",
        content: `m-${i}`,
      });
    }

    const history = store.getHistory("sess-1", "talk_to_me");
    expect(history).toHaveLength(10);
    expect(history[0]?.content).toBe("m-4");
    expect(history[9]?.content).toBe("m-13");
  });

  it("isolates history by mode within the same sessionId", () => {
    const store = new ConversationStore();
    store.append("sess-1", "talk_to_me", {
      role: "user",
      content: "chat question",
    });
    store.append("sess-1", "teach_me", {
      role: "user",
      content: "teach topic",
    });

    expect(store.getHistory("sess-1", "talk_to_me")).toEqual([
      { role: "user", content: "chat question" },
    ]);
    expect(store.getHistory("sess-1", "teach_me")).toEqual([
      { role: "user", content: "teach topic" },
    ]);
  });
});

describe("ConversationService", () => {
  it("includes compact approval context in the prompt", async () => {
    const store = new ConversationStore();
    const ai = new ScriptedStreamProvider({ tokens: ["ok"] });
    const service = new ConversationService(ai, store, {
      approvals: APPROVALS,
    });

    await collect(
      service.streamTurn({
        sessionId: "s1",
        mode: "talk_to_me",
        message: "What is waiting?",
      }),
    );

    for (const approval of APPROVALS) {
      expect(ai.lastPrompt).toContain(approval.id);
      expect(ai.lastPrompt).toContain(approval.title);
    }
  });

  it("streams chat responses with the chat.v1 prompt", async () => {
    const store = new ConversationStore();
    const ai = new ScriptedStreamProvider({ tokens: ["Hel", "lo"] });
    const service = new ConversationService(ai, store);

    const chunks = await collect(
      service.streamTurn({
        sessionId: "s1",
        mode: "talk_to_me",
        message: "Hello there",
      }),
    );

    expect(chunks).toEqual(["Hel", "lo"]);
    expect(ai.lastPrompt).toContain(CHAT_PROMPT_VERSION);
    expect(ai.lastPrompt).toContain(buildChatPrompt().slice(0, 40));
    expect(ai.streamCalls).toBe(1);
  });

  it("streams teach responses with the deterministic workflow skeleton", async () => {
    const store = new ConversationStore();
    const ai = new ScriptedStreamProvider({ tokens: ["Step", " 1"] });
    const service = new ConversationService(ai, store);

    const chunks = await collect(
      service.streamTurn({
        sessionId: "s1",
        mode: "teach_me",
        message: "How do I review a PDF?",
      }),
    );

    expect(chunks.join("")).toBe("Step 1");
    expect(ai.lastPrompt).toContain(TEACH_PROMPT_VERSION);
    expect(ai.lastPrompt.toLowerCase()).toContain("open item");
    expect(ai.lastPrompt.toLowerCase()).toContain("verify type");
    expect(ai.lastPrompt.toLowerCase()).toContain("check policy");
    expect(ai.lastPrompt.toLowerCase()).toContain("decide");
    expect(ai.lastPrompt.toLowerCase()).toContain("record action");
    expect(ai.lastPrompt.toLowerCase()).toMatch(/must not invent policy/);
    expect(buildTeachPrompt()).toMatch(/1\.\s*open item/i);
  });

  it("saves the full assistant message only after successful completion", async () => {
    const store = new ConversationStore();
    const ai = new ScriptedStreamProvider({ tokens: ["A", "B"] });
    const service = new ConversationService(ai, store);

    await collect(
      service.streamTurn({
        sessionId: "s1",
        mode: "talk_to_me",
        message: "ping",
      }),
    );

    expect(store.getHistory("s1", "talk_to_me")).toEqual([
      { role: "user", content: "ping" },
      { role: "assistant", content: "AB" },
    ]);
  });

  it("does not save an interrupted stream as a complete assistant turn", async () => {
    const store = new ConversationStore();
    const ai = new ScriptedStreamProvider({
      tokens: ["partial", "more"],
      failAfter: 1,
      error: new Error("boom"),
    });
    const service = new ConversationService(ai, store);

    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const chunk of service.streamTurn({
          sessionId: "s1",
          mode: "talk_to_me",
          message: "ping",
        })) {
          seen.push(chunk);
        }
      })(),
    ).rejects.toThrow("boom");

    expect(seen).toEqual(["partial"]);
    expect(store.getHistory("s1", "talk_to_me")).toEqual([]);
  });

  it("stops on abort and does not persist a completed assistant message", async () => {
    const store = new ConversationStore();
    const ai = new ScriptedStreamProvider({
      tokens: ["one", "two", "three"],
    });
    const service = new ConversationService(ai, store);
    const controller = new AbortController();

    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const chunk of service.streamTurn({
          sessionId: "s1",
          mode: "talk_to_me",
          message: "abort me",
          signal: controller.signal,
        })) {
          seen.push(chunk);
          if (seen.length === 1) {
            controller.abort();
          }
        }
      })(),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(store.getHistory("s1", "talk_to_me")).toEqual([]);
  });

  it("loads prior history into the provider messages for the next turn", async () => {
    const store = new ConversationStore();
    store.append("s1", "talk_to_me", { role: "user", content: "earlier" });
    store.append("s1", "talk_to_me", {
      role: "assistant",
      content: "prior reply",
    });

    const ai = new ScriptedStreamProvider({ tokens: ["next"] });
    const service = new ConversationService(ai, store);

    await collect(
      service.streamTurn({
        sessionId: "s1",
        mode: "talk_to_me",
        message: "follow up",
      }),
    );

    expect(ai.lastMessages).toEqual(
      expect.arrayContaining([
        { role: "user", content: "earlier" },
        { role: "assistant", content: "prior reply" },
        { role: "user", content: "follow up" },
      ]),
    );
  });
});
