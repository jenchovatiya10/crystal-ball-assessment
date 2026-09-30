import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Approval } from "@crystal-ball/shared";
import { AssistantPanel } from "@/components/AssistantPanel";
import type { ParsedSseEvent } from "@/lib/sseParser";
import { useConversationStore } from "@/store/conversationStore";
import { useUiStore } from "@/store/uiStore";

vi.mock("@/lib/apiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/apiClient")>();
  return {
    ...actual,
    getSummary: vi.fn().mockResolvedValue({
      data: {
        overview: "Queue looks manageable.",
        priorityItems: [
          {
            approvalId: "apr_folder_site_patrol_onboarding",
            priority: "high",
            reason: "Due soon",
          },
        ],
        recommendedNextAction: "Start with the oldest due item.",
      },
      meta: { source: "ai", promptVersion: "summary.v1" },
    }),
    getHelp: vi.fn().mockResolvedValue({
      data: {
        answer: "Escalate within one business day.",
        sources: ["policy-03"],
        grounded: true,
      },
      meta: { source: "ai", promptVersion: "help.v1" },
    }),
    getGreeting: vi.fn().mockResolvedValue({
      greeting:
        "Good morning. You have 1 approval waiting. The Site Patrol Onboarding & Checklists Folder needs your attention first.",
      meta: {
        dayPart: "morning",
        totalCount: 1,
        urgency: { critical: 0, high: 1, medium: 0, low: 0 },
        highestPriorityApprovalId: "apr_folder_site_patrol_onboarding",
        highestPriorityTitle: "Site Patrol Onboarding & Checklists Folder",
        language: "en",
      },
    }),
    streamChat: vi.fn(),
    streamTeach: vi.fn(),
  };
});

import { streamChat } from "@/lib/apiClient";

const streamChatMock = vi.mocked(streamChat);

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

const approvals: Approval[] = [
  {
    id: "apr_folder_site_patrol_onboarding",
    title: "Site Patrol Onboarding & Checklists Folder",
    type: "folder",
    submittedAt: "2026-09-20T09:00:00.000Z",
    dueAt: "2026-10-02T17:00:00.000Z",
    flags: ["checklist"],
  },
];

function resetStores(): void {
  useUiStore.setState({ panelOpen: true, activeMode: "summary" });
  useConversationStore.setState({
    sessionId: "11111111-1111-4111-8111-111111111111",
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
}

describe("AssistantPanel", () => {
  beforeEach(() => {
    resetStores();
    streamChatMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders approvals and summary mode by default", async () => {
    render(<AssistantPanel approvals={approvals} />);

    expect(
      screen.getByRole("heading", { name: /crystal ball/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("approvals loaded")).toBeInTheDocument();
    expect(
      screen.getByText(/Site Patrol Onboarding & Checklists Folder/),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("region", { name: /present me summary/i }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/queue looks manageable/i)).toBeInTheDocument();
  });

  it("switches across all five modes without prop-drilled views", async () => {
    const user = userEvent.setup();
    render(<AssistantPanel approvals={approvals} />);

    await user.click(screen.getByRole("tab", { name: /talk to me/i }));
    expect(
      screen.getByRole("region", { name: /talk to me/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /send message/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /help me/i }));
    expect(screen.getByRole("region", { name: /help me/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/policy question/i)).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /teach me/i }));
    expect(
      screen.getByRole("region", { name: /teach me/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /send message/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /replay greeting/i }));
    expect(
      screen.getByRole("region", { name: /greeting/i }),
    ).toBeInTheDocument();
    expect(
      await screen.findByTestId("greeting-message"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /present me summary/i }));
    expect(
      await screen.findByRole("region", { name: /present me summary/i }),
    ).toBeInTheDocument();
  });

  it("supports keyboard navigation between accessible tabs", async () => {
    const user = userEvent.setup();
    render(<AssistantPanel approvals={approvals} />);

    const summary = screen.getByRole("tab", { name: /present me summary/i });
    summary.focus();
    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("tab", { name: /talk to me/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: /talk to me/i })).toHaveFocus();
    expect(
      screen.getByRole("region", { name: /talk to me/i }),
    ).toBeInTheDocument();
  });

  it("aborts an active talk stream when switching modes", async () => {
    const deferred = createDeferredStream();
    streamChatMock.mockImplementation(abortAwareStream(deferred));
    const user = userEvent.setup();

    render(<AssistantPanel approvals={approvals} />);

    await user.click(screen.getByRole("tab", { name: /talk to me/i }));
    await user.type(screen.getByLabelText(/^message$/i), "Hello queue");
    await user.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /stop generating/i }),
      ).toBeInTheDocument();
    });

    await act(async () => {
      deferred.push({
        event: "token",
        data: { t: "partial" },
        rawData: '{"t":"partial"}',
      });
    });
    await waitFor(() => {
      expect(screen.getByText("partial")).toBeInTheDocument();
    });

    const signal = useConversationStore.getState().abortController?.signal;
    expect(signal?.aborted).toBe(false);

    await user.click(screen.getByRole("tab", { name: /help me/i }));

    await waitFor(() => {
      expect(signal?.aborted).toBe(true);
      expect(useConversationStore.getState().interruptedByMode.talk).toBe(true);
    });

    act(() => {
      deferred.end();
    });
  });

  it("aborts an active stream when the panel is collapsed", async () => {
    const deferred = createDeferredStream();
    streamChatMock.mockImplementation(abortAwareStream(deferred));
    const user = userEvent.setup();

    render(<AssistantPanel approvals={approvals} />);

    await user.click(screen.getByRole("tab", { name: /talk to me/i }));
    await user.type(screen.getByLabelText(/^message$/i), "Hello queue");
    await user.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /stop generating/i }),
      ).toBeInTheDocument();
    });

    const signal = useConversationStore.getState().abortController?.signal;
    await user.click(screen.getByRole("button", { name: /hide panel/i }));

    await waitFor(() => {
      expect(signal?.aborted).toBe(true);
      expect(useConversationStore.getState().interruptedByMode.talk).toBe(true);
    });

    act(() => {
      deferred.end();
    });
  });
});
