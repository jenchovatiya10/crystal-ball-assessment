import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedSseEvent } from "@/lib/sseParser";
import { useConversation } from "@/hooks/useConversation";
import { useConversationStore } from "@/store/conversationStore";
import { useUiStore } from "@/store/uiStore";

vi.mock("@/lib/apiClient", () => ({
  ApiClientError: class ApiClientError extends Error {
    status: number;
    code: string;
    constructor(
      message: string,
      options: { status: number; code?: string },
    ) {
      super(message);
      this.name = "ApiClientError";
      this.status = options.status;
      this.code = options.code ?? "HTTP_ERROR";
    }
  },
  streamChat: vi.fn(),
  streamTeach: vi.fn(),
}));

import { ApiClientError, streamChat, streamTeach } from "@/lib/apiClient";

const streamChatMock = vi.mocked(streamChat);
const streamTeachMock = vi.mocked(streamTeach);

type DeferredStream = {
  push: (event: ParsedSseEvent) => void;
  end: () => void;
  fail: (error: unknown) => void;
  generator: () => AsyncGenerator<ParsedSseEvent, void, undefined>;
};

function createDeferredStream(): DeferredStream {
  const queue: ParsedSseEvent[] = [];
  let notify: (() => void) | null = null;
  let finished = false;
  let rejection: unknown = null;

  const wake = () => {
    notify?.();
    notify = null;
  };

  return {
    push(event) {
      queue.push(event);
      wake();
    },
    end() {
      finished = true;
      wake();
    },
    fail(error) {
      rejection = error;
      finished = true;
      wake();
    },
    async *generator() {
      while (true) {
        if (rejection) {
          throw rejection;
        }
        if (queue.length > 0) {
          yield queue.shift()!;
          continue;
        }
        if (finished) {
          return;
        }
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
      }
    },
  };
}

function sse(
  event: ParsedSseEvent["event"],
  data: unknown,
): ParsedSseEvent {
  return {
    event,
    data,
    rawData: JSON.stringify(data),
  };
}

function resetStores(): void {
  useConversationStore.setState({
    sessionId: "test-session",
    messagesByMode: {
      summary: [],
      talk: [],
      help: [],
      teach: [],
      greeting: [],
    },
    statusByMode: {
      summary: "idle",
      talk: "idle",
      help: "idle",
      teach: "idle",
      greeting: "idle",
    },
    interruptedByMode: {
      summary: false,
      talk: false,
      help: false,
      teach: false,
      greeting: false,
    },
    fallbackByMode: {
      summary: false,
      talk: false,
      help: false,
      teach: false,
      greeting: false,
    },
    abortController: null,
  });
  useUiStore.setState({
    panelOpen: true,
    activeMode: "talk",
  });
}

describe("useConversation", () => {
  beforeEach(() => {
    resetStores();
    streamChatMock.mockReset();
    streamTeachMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sends a user message and opens an assistant placeholder", async () => {
    const deferred = createDeferredStream();
    streamChatMock.mockImplementation(deferred.generator);

    const { result } = renderHook(() => useConversation("talk"));

    let sendPromise: Promise<void>;
    act(() => {
      sendPromise = result.current.sendMessage("Hello queue");
    });

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2);
    });

    expect(result.current.messages[0]).toMatchObject({
      role: "user",
      content: "Hello queue",
    });
    expect(result.current.messages[1]).toMatchObject({
      role: "assistant",
      content: "",
    });
    expect(result.current.isStreaming).toBe(true);
    expect(streamChatMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "test-session",
        message: "Hello queue",
      }),
    );

    act(() => {
      deferred.push(sse("meta", { sessionId: "test-session", requestId: "r1" }));
      deferred.push(sse("done", {}));
      deferred.end();
    });
    await act(async () => {
      await sendPromise!;
    });
  });

  it("appends tokens incrementally", async () => {
    const deferred = createDeferredStream();
    streamChatMock.mockImplementation(deferred.generator);

    const { result } = renderHook(() => useConversation("talk"));

    let sendPromise: Promise<void>;
    act(() => {
      sendPromise = result.current.sendMessage("hi");
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(true));

    await act(async () => {
      deferred.push(sse("meta", { sessionId: "test-session", requestId: "r1" }));
      deferred.push(sse("token", { t: "Hel" }));
    });

    await waitFor(() => {
      expect(result.current.messages.at(-1)?.content).toBe("Hel");
    });
    expect(result.current.meta).toEqual({
      sessionId: "test-session",
      requestId: "r1",
    });

    await act(async () => {
      deferred.push(sse("token", { t: "lo" }));
    });

    await waitFor(() => {
      expect(result.current.messages.at(-1)?.content).toBe("Hello");
    });

    await act(async () => {
      deferred.push(sse("done", {}));
      deferred.end();
      await sendPromise!;
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.messages.at(-1)?.content).toBe("Hello");
  });

  it("finishes cleanly on done", async () => {
    streamTeachMock.mockImplementation(async function* () {
      yield sse("meta", { sessionId: "test-session", requestId: "t1" });
      yield sse("token", { t: "Step 1" });
      yield sse("done", {});
    });
    useUiStore.setState({ activeMode: "teach" });

    const { result } = renderHook(() => useConversation("teach"));

    await act(async () => {
      await result.current.sendMessage("Teach me");
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.fallback).toBe(false);
    expect(result.current.interrupted).toBe(false);
    expect(result.current.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "Step 1",
    });
    expect(useConversationStore.getState().abortController).toBeNull();
  });

  it("marks fallback when done includes fallback", async () => {
    streamChatMock.mockImplementation(async function* () {
      yield sse("meta", { sessionId: "test-session", requestId: "r1" });
      yield sse("token", { t: "Sorry, limited answer." });
      yield sse("done", { fallback: true });
    });

    const { result } = renderHook(() => useConversation("talk"));

    await act(async () => {
      await result.current.sendMessage("Hello");
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.fallback).toBe(true);
    expect(result.current.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "Sorry, limited answer.",
      fallback: true,
    });
  });

  it("handles stream error events without retrying", async () => {
    streamChatMock.mockImplementation(async function* () {
      yield sse("meta", { sessionId: "test-session", requestId: "r1" });
      yield sse("token", { t: "partial" });
      yield sse("error", {
        code: "AI_UNAVAILABLE",
        message: "mid-stream failure",
        fallback: true,
      });
    });

    const { result } = renderHook(() => useConversation("talk"));

    await act(async () => {
      await result.current.sendMessage("Hello");
    });

    expect(streamChatMock).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("error");
    expect(result.current.fallback).toBe(true);
    expect(result.current.error).toEqual({
      code: "AI_UNAVAILABLE",
      message: "mid-stream failure",
    });
    expect(result.current.messages.at(-1)?.content).toBe("partial");
  });

  it("handles pre-stream ApiClientError without retrying", async () => {
    streamChatMock.mockImplementation(() => {
      throw new ApiClientError("Too many requests", {
        status: 429,
        code: "RATE_LIMITED",
      });
    });

    const { result } = renderHook(() => useConversation("talk"));

    await act(async () => {
      await result.current.sendMessage("Hello");
    });

    expect(streamChatMock).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("error");
    expect(result.current.error).toEqual({
      code: "RATE_LIMITED",
      message: "Too many requests",
    });
  });

  it("aborts the in-flight request when stop is called", async () => {
    const deferred = createDeferredStream();
    streamChatMock.mockImplementation((options) => {
      const signal = options.signal;
      const inner = deferred.generator();
      return (async function* () {
        for await (const event of inner) {
          if (signal?.aborted) {
            const err = new Error("Aborted");
            err.name = "AbortError";
            throw err;
          }
          yield event;
        }
      })();
    });

    const { result } = renderHook(() => useConversation("talk"));

    let sendPromise: Promise<void>;
    act(() => {
      sendPromise = result.current.sendMessage("Hello");
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(true));

    await act(async () => {
      deferred.push(sse("token", { t: "partial" }));
    });
    await waitFor(() => {
      expect(result.current.messages.at(-1)?.content).toBe("partial");
    });

    const signal = useConversationStore.getState().abortController?.signal;
    expect(signal?.aborted).toBe(false);

    act(() => {
      result.current.stop();
    });

    expect(signal?.aborted).toBe(true);
    expect(result.current.interrupted).toBe(true);
    expect(result.current.status).toBe("error");
    expect(result.current.messages.at(-1)).toMatchObject({
      content: "partial",
      interrupted: true,
    });

    act(() => {
      deferred.end();
    });
    await act(async () => {
      await sendPromise!;
    });

    expect(streamChatMock).toHaveBeenCalledTimes(1);
  });

  it("marks an interrupted stream when unmount aborts", async () => {
    const deferred = createDeferredStream();
    streamChatMock.mockImplementation((options) => {
      const signal = options.signal;
      const inner = deferred.generator();
      return (async function* () {
        for await (const event of inner) {
          if (signal?.aborted) {
            const err = new Error("Aborted");
            err.name = "AbortError";
            throw err;
          }
          yield event;
        }
      })();
    });

    const { result, unmount } = renderHook(() => useConversation("talk"));

    let sendPromise: Promise<void>;
    act(() => {
      sendPromise = result.current.sendMessage("Hello");
    });

    await waitFor(() => expect(result.current.isStreaming).toBe(true));
    await act(async () => {
      deferred.push(sse("token", { t: "cut" }));
    });
    await waitFor(() => {
      expect(
        useConversationStore.getState().messagesByMode.talk.at(-1)?.content,
      ).toBe("cut");
    });

    act(() => {
      unmount();
    });

    expect(useConversationStore.getState().interruptedByMode.talk).toBe(true);
    expect(
      useConversationStore.getState().messagesByMode.talk.at(-1),
    ).toMatchObject({
      content: "cut",
      interrupted: true,
    });

    act(() => {
      deferred.end();
    });
    await act(async () => {
      await sendPromise!;
    });
  });

  it("aborts when the active mode switches away", async () => {
    const deferred = createDeferredStream();
    streamChatMock.mockImplementation((options) => {
      const signal = options.signal;
      const inner = deferred.generator();
      return (async function* () {
        for await (const event of inner) {
          if (signal?.aborted) {
            const err = new Error("Aborted");
            err.name = "AbortError";
            throw err;
          }
          yield event;
        }
      })();
    });

    const { result } = renderHook(() => useConversation("talk"));

    let sendPromise: Promise<void>;
    act(() => {
      sendPromise = result.current.sendMessage("Hello");
    });
    await waitFor(() => expect(result.current.isStreaming).toBe(true));
    await act(async () => {
      deferred.push(sse("token", { t: "mid" }));
    });
    await waitFor(() => {
      expect(result.current.messages.at(-1)?.content).toBe("mid");
    });

    act(() => {
      useUiStore.getState().setActiveMode("summary");
    });

    await waitFor(() => {
      expect(result.current.interrupted).toBe(true);
    });
    expect(result.current.messages.at(-1)).toMatchObject({
      content: "mid",
      interrupted: true,
    });

    act(() => {
      deferred.end();
    });
    await act(async () => {
      await sendPromise!;
    });
  });
});
