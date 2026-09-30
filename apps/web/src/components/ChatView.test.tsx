import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "@/components/ChatView";
import type { ParsedSseEvent } from "@/lib/sseParser";
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
  generator: () => AsyncGenerator<ParsedSseEvent, void, undefined>;
};

function createDeferredStream(): DeferredStream {
  const queue: ParsedSseEvent[] = [];
  let notify: (() => void) | null = null;
  let finished = false;

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
    async *generator() {
      while (true) {
        if (queue.length > 0) {
          yield queue.shift()!;
          continue;
        }
        if (finished) return;
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

function abortAwareStream(
  deferred: DeferredStream,
): (options: { signal?: AbortSignal }) => AsyncGenerator<ParsedSseEvent> {
  return (options) => {
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

describe("ChatView", () => {
  beforeEach(() => {
    resetStores();
    streamChatMock.mockReset();
    streamTeachMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the initial empty conversation state", () => {
    render(<ChatView mode="talk" />);

    expect(
      screen.getByRole("region", { name: /talk to me/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/no messages yet/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^message$/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /send message/i }),
    ).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sends a user message and shows it in the list", async () => {
    const deferred = createDeferredStream();
    streamChatMock.mockImplementation(abortAwareStream(deferred));
    const user = userEvent.setup();

    render(<ChatView mode="talk" />);

    await user.type(
      screen.getByLabelText(/^message$/i),
      "What is overdue?",
    );
    await user.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => {
      expect(screen.getByText("What is overdue?")).toBeInTheDocument();
    });
    expect(streamChatMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "What is overdue?",
        sessionId: "test-session",
      }),
    );

    await act(async () => {
      deferred.push(sse("done", {}));
      deferred.end();
    });

    await waitFor(() => {
      expect(screen.queryByText(/generating response/i)).not.toBeInTheDocument();
    });
  });

  it("streams assistant tokens into the message list", async () => {
    const deferred = createDeferredStream();
    streamChatMock.mockImplementation(abortAwareStream(deferred));
    const user = userEvent.setup();

    render(<ChatView mode="talk" />);

    await user.type(screen.getByLabelText(/^message$/i), "Hello");
    await user.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => {
      expect(screen.getByText(/generating response/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/^message$/i)).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /stop generating/i }),
    ).toBeInTheDocument();

    await act(async () => {
      deferred.push(sse("meta", { sessionId: "test-session", requestId: "r1" }));
      deferred.push(sse("token", { t: "Hi" }));
    });

    await waitFor(() => {
      expect(screen.getByText("Hi")).toBeInTheDocument();
    });

    await act(async () => {
      deferred.push(sse("token", { t: " there" }));
      deferred.push(sse("done", {}));
      deferred.end();
    });

    await waitFor(() => {
      expect(screen.getByText("Hi there")).toBeInTheDocument();
      expect(screen.queryByText(/generating response/i)).not.toBeInTheDocument();
    });
  });

  it("stops an in-flight stream from the stop button", async () => {
    const deferred = createDeferredStream();
    streamChatMock.mockImplementation(abortAwareStream(deferred));
    const user = userEvent.setup();

    render(<ChatView mode="talk" />);

    await user.type(screen.getByLabelText(/^message$/i), "Hello");
    await user.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /stop generating/i }),
      ).toBeInTheDocument();
    });

    await act(async () => {
      deferred.push(sse("token", { t: "partial" }));
    });
    await waitFor(() => {
      expect(screen.getByText("partial")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /stop generating/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/interrupted/i);
      expect(screen.getByText("Interrupted")).toBeInTheDocument();
    });

    act(() => {
      deferred.end();
    });
  });

  it("shows an error alert when the stream fails", async () => {
    streamChatMock.mockImplementation(() => {
      throw new ApiClientError("Upstream unavailable", {
        status: 503,
        code: "AI_UNAVAILABLE",
      });
    });
    const user = userEvent.setup();

    render(<ChatView mode="talk" />);

    await user.type(screen.getByLabelText(/^message$/i), "Hello");
    await user.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /upstream unavailable/i,
      );
    });
    expect(
      screen.getByRole("button", { name: /retry last message/i }),
    ).toBeInTheDocument();
  });

  it("marks interrupted assistant messages", async () => {
    const deferred = createDeferredStream();
    streamChatMock.mockImplementation(abortAwareStream(deferred));
    const user = userEvent.setup();

    render(<ChatView mode="talk" />);

    await user.type(screen.getByLabelText(/^message$/i), "Hello");
    await user.click(screen.getByRole("button", { name: /send message/i }));

    await act(async () => {
      deferred.push(sse("token", { t: "cut off" }));
    });
    await waitFor(() => {
      expect(screen.getByText("cut off")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /stop generating/i }));

    await waitFor(() => {
      const assistant = screen.getByTestId("message-assistant");
      expect(within(assistant).getByText("Interrupted")).toBeInTheDocument();
      expect(within(assistant).getByText("cut off")).toBeInTheDocument();
    });

    act(() => {
      deferred.end();
    });
  });

  it("retries the last message after an error", async () => {
    streamChatMock
      .mockImplementationOnce(() => {
        throw new ApiClientError("Temporary failure", {
          status: 503,
          code: "AI_UNAVAILABLE",
        });
      })
      .mockImplementation(async function* () {
        yield sse("token", { t: "Recovered" });
        yield sse("done", {});
      });

    const user = userEvent.setup();
    render(<ChatView mode="talk" />);

    await user.type(screen.getByLabelText(/^message$/i), "Try again");
    await user.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/temporary failure/i);
    });

    await user.click(
      screen.getByRole("button", { name: /retry last message/i }),
    );

    await waitFor(() => {
      expect(screen.getByText("Recovered")).toBeInTheDocument();
    });
    expect(streamChatMock).toHaveBeenCalledTimes(2);
    expect(streamChatMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: "Try again" }),
    );
  });

  it("keeps Talk and Teach histories isolated when switching modes", async () => {
    streamChatMock.mockImplementation(async function* () {
      yield sse("token", { t: "Talk answer" });
      yield sse("done", {});
    });
    streamTeachMock.mockImplementation(async function* () {
      yield sse("token", { t: "Teach answer" });
      yield sse("done", {});
    });

    const user = userEvent.setup();
    const { rerender } = render(<ChatView mode="talk" />);

    await user.type(screen.getByLabelText(/^message$/i), "Talk question");
    await user.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => {
      expect(screen.getByText("Talk answer")).toBeInTheDocument();
      expect(screen.queryByText(/generating response/i)).not.toBeInTheDocument();
    });

    act(() => {
      useUiStore.setState({ activeMode: "teach" });
    });
    rerender(<ChatView mode="teach" />);

    expect(
      screen.getByRole("region", { name: /teach me/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Talk answer")).not.toBeInTheDocument();
    expect(screen.getByText(/no messages yet/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^message$/i), "Teach question");
    await user.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => {
      expect(screen.getByText("Teach answer")).toBeInTheDocument();
      expect(screen.queryByText(/generating response/i)).not.toBeInTheDocument();
    });
    expect(streamTeachMock).toHaveBeenCalled();
    expect(screen.queryByText("Talk answer")).not.toBeInTheDocument();

    act(() => {
      useUiStore.setState({ activeMode: "talk" });
    });
    rerender(<ChatView mode="talk" />);

    expect(screen.getByText("Talk answer")).toBeInTheDocument();
    expect(screen.queryByText("Teach answer")).not.toBeInTheDocument();
  });
});
