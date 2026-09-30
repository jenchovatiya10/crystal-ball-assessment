import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GreetingBar } from "@/components/GreetingBar";
import type { GreetingApiResponse } from "@/lib/apiClient";
import { useConversationStore } from "@/store/conversationStore";

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
  getGreeting: vi.fn(),
}));

import { ApiClientError, getGreeting } from "@/lib/apiClient";

const getGreetingMock = vi.mocked(getGreeting);

const fixtureGreeting: GreetingApiResponse = {
  greeting:
    "Good morning. You have 4 approvals waiting. Including 1 high item. The Site Patrol Onboarding & Checklists Folder needs your attention first.",
  meta: {
    dayPart: "morning",
    totalCount: 4,
    urgency: { critical: 0, high: 1, medium: 2, low: 1 },
    highestPriorityApprovalId: "apr_folder_site_patrol_onboarding",
    highestPriorityTitle: "Site Patrol Onboarding & Checklists Folder",
    language: "en",
  },
};

function resetStore(): void {
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

describe("GreetingBar", () => {
  beforeEach(() => {
    resetStore();
    getGreetingMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("loads the current greeting on mount from fixture-backed API data", async () => {
    getGreetingMock.mockResolvedValue(fixtureGreeting);

    render(<GreetingBar />);

    expect(screen.getByRole("status")).toHaveTextContent(/loading greeting/i);

    await waitFor(() => {
      expect(screen.getByTestId("greeting-message")).toHaveTextContent(
        /4 approvals waiting/i,
      );
    });

    expect(screen.getByTestId("greeting-message")).toHaveTextContent(
      /Site Patrol Onboarding & Checklists Folder/i,
    );
    expect(screen.getByTestId("greeting-meta")).toHaveTextContent(/morning/i);
    expect(screen.getByTestId("greeting-meta")).toHaveTextContent(/4 waiting/i);
    expect(getGreetingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "11111111-1111-4111-8111-111111111111",
      }),
    );
    expect(getGreetingMock.mock.calls[0]?.[0]).not.toHaveProperty("language");
  });

  it("replays the greeting when the Replay Greeting button is pressed", async () => {
    getGreetingMock
      .mockResolvedValueOnce(fixtureGreeting)
      .mockResolvedValueOnce({
        ...fixtureGreeting,
        greeting:
          "Good afternoon. You have 4 approvals waiting. Including 1 high item. The Site Patrol Onboarding & Checklists Folder needs your attention first.",
        meta: {
          ...fixtureGreeting.meta,
          dayPart: "afternoon",
        },
      });

    const user = userEvent.setup();
    render(<GreetingBar />);

    await waitFor(() => {
      expect(screen.getByTestId("greeting-message")).toHaveTextContent(
        /good morning/i,
      );
    });

    await user.click(
      screen.getByRole("button", { name: /replay greeting/i }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("greeting-message")).toHaveTextContent(
        /good afternoon/i,
      );
    });
    expect(getGreetingMock).toHaveBeenCalledTimes(2);
  });

  it("shows loading while a replay request is in flight", async () => {
    let resolveReplay!: (value: GreetingApiResponse) => void;
    getGreetingMock
      .mockResolvedValueOnce(fixtureGreeting)
      .mockImplementationOnce(
        () =>
          new Promise<GreetingApiResponse>((resolve) => {
            resolveReplay = resolve;
          }),
      );

    const user = userEvent.setup();
    render(<GreetingBar />);

    await waitFor(() => {
      expect(screen.getByTestId("greeting-message")).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("button", { name: /replay greeting/i }),
    );

    expect(screen.getByRole("status")).toHaveTextContent(/loading greeting/i);
    expect(
      screen.getByRole("button", { name: /replay greeting/i }),
    ).toBeDisabled();

    resolveReplay({
      ...fixtureGreeting,
      greeting: "Good evening. You have 4 approvals waiting.",
      meta: { ...fixtureGreeting.meta, dayPart: "evening" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("greeting-message")).toHaveTextContent(
        /good evening/i,
      );
    });
  });

  it("passes language through when the UI provides one", async () => {
    getGreetingMock.mockResolvedValue({
      ...fixtureGreeting,
      greeting: "Buenos días. Tienes 4 aprobaciones en espera.",
      meta: { ...fixtureGreeting.meta, language: "es" },
    });

    render(<GreetingBar language="es" />);

    await waitFor(() => {
      expect(screen.getByTestId("greeting-message")).toHaveTextContent(
        /buenos días/i,
      );
    });

    expect(getGreetingMock).toHaveBeenCalledWith(
      expect.objectContaining({ language: "es" }),
    );
  });

  it("shows an error alert when greeting fetch fails", async () => {
    getGreetingMock.mockRejectedValue(
      new ApiClientError("Greeting unavailable", {
        status: 503,
        code: "HTTP_ERROR",
      }),
    );

    render(<GreetingBar />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /greeting unavailable/i,
      );
    });
  });
});
