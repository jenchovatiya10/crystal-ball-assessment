import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SummaryView } from "@/components/SummaryView";
import type { SummaryApiResponse } from "@/lib/apiClient";
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
  getSummary: vi.fn(),
}));

import { ApiClientError, getSummary } from "@/lib/apiClient";

const getSummaryMock = vi.mocked(getSummary);

const successResponse: SummaryApiResponse = {
  data: {
    overview: "Four approvals need attention before the patrol window closes.",
    priorityItems: [
      {
        approvalId: "apr_folder_site_patrol_onboarding",
        priority: "high",
        reason: "Onboarding checklist is due soon and blocks field access.",
      },
      {
        approvalId: "apr_pdf_incident_report",
        priority: "medium",
        reason: "Incident report awaiting reviewer sign-off.",
      },
    ],
    recommendedNextAction:
      "Review the Site Patrol Onboarding & Checklists Folder first.",
  },
  meta: {
    source: "ai",
    promptVersion: "summary.v1",
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

describe("SummaryView", () => {
  beforeEach(() => {
    resetStore();
    getSummaryMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows a loading state while fetching", () => {
    getSummaryMock.mockImplementation(
      () => new Promise(() => undefined) as Promise<SummaryApiResponse>,
    );

    render(<SummaryView />);

    expect(screen.getByRole("status")).toHaveTextContent(/loading summary/i);
    expect(getSummaryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "11111111-1111-4111-8111-111111111111",
      }),
    );
  });

  it("renders structured summary fields on success", async () => {
    getSummaryMock.mockResolvedValue(successResponse);

    render(<SummaryView />);

    await waitFor(() => {
      expect(
        screen.getByText(successResponse.data.overview),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByRole("region", { name: /overview/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: /priority items/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("priority-badge-apr_folder_site_patrol_onboarding"),
    ).toHaveTextContent("high");
    expect(
      screen.getByText(
        /Onboarding checklist is due soon and blocks field access/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: /recommended next action/i }),
    ).toHaveTextContent(successResponse.data.recommendedNextAction);
    expect(
      screen.queryByTestId("summary-fallback-indicator"),
    ).not.toBeInTheDocument();
  });

  it("shows a basic-mode indicator when meta.source is fallback", async () => {
    getSummaryMock.mockResolvedValue({
      ...successResponse,
      meta: {
        source: "fallback",
        reason: "timeout",
        promptVersion: "summary.v1",
      },
    });

    render(<SummaryView />);

    await waitFor(() => {
      expect(
        screen.getByTestId("summary-fallback-indicator"),
      ).toBeInTheDocument();
    });

    expect(screen.getByTestId("summary-fallback-indicator")).toHaveTextContent(
      /basic mode/i,
    );
    expect(screen.getByTestId("summary-fallback-indicator")).toHaveTextContent(
      /timeout/i,
    );
    expect(
      screen.getByText(successResponse.data.overview),
    ).toBeInTheDocument();
  });

  it("shows an error alert when the summary request fails", async () => {
    getSummaryMock.mockRejectedValue(
      new ApiClientError("Summary unavailable", {
        status: 503,
        code: "AI_UNAVAILABLE",
      }),
    );

    render(<SummaryView />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /summary unavailable/i,
      );
    });
    expect(screen.queryByText(/loading summary/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: /overview/i }),
    ).not.toBeInTheDocument();
  });

  it("does not calculate ranking and only renders backend priority order", async () => {
    getSummaryMock.mockResolvedValue(successResponse);

    render(<SummaryView />);

    await waitFor(() => {
      expect(
        screen.getByText("apr_folder_site_patrol_onboarding"),
      ).toBeInTheDocument();
    });

    const items = screen.getAllByText(/^apr_/);
    expect(items.map((node) => node.textContent)).toEqual([
      "apr_folder_site_patrol_onboarding",
      "apr_pdf_incident_report",
    ]);
  });
});
