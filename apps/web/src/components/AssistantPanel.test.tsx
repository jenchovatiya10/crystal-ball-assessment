import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Approval } from "@crystal-ball/shared";
import { AssistantPanel } from "@/components/AssistantPanel";
import { useUiStore } from "@/store/uiStore";

vi.mock("@/lib/apiClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/apiClient")>();
  return {
    ...actual,
    getSummary: vi.fn().mockResolvedValue({
      data: {
        overview: "Queue looks manageable.",
        priorityItems: [],
        recommendedNextAction: "Start with the oldest due item.",
      },
      meta: { source: "ai", promptVersion: "summary.v1" },
    }),
  };
});

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

describe("AssistantPanel", () => {
  beforeEach(() => {
    useUiStore.setState({ panelOpen: true, activeMode: "summary" });
  });

  it("renders approvals passed from the server", async () => {
    render(<AssistantPanel approvals={approvals} />);

    expect(
      screen.getByRole("heading", { name: /crystal ball/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("approvals loaded")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(
      screen.getByText(/Site Patrol Onboarding & Checklists Folder/),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("region", { name: /present me summary/i }),
    ).toBeInTheDocument();
  });

  it("shows greeting bar when greeting mode is selected", async () => {
    const user = userEvent.setup();
    render(<AssistantPanel approvals={approvals} />);

    await user.click(screen.getByRole("tab", { name: /replay greeting/i }));

    expect(
      screen.getByRole("region", { name: /greeting/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/live queue pulse/i)).toBeInTheDocument();
  });
});
