import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModeTabs } from "@/components/ModeTabs";
import type { AssistantMode } from "@/lib/assistant-modes";
import { useState } from "react";

function TabsHarness({ initial = "summary" as AssistantMode }) {
  const [mode, setMode] = useState<AssistantMode>(initial);
  return <ModeTabs activeMode={mode} onModeChange={setMode} />;
}

describe("ModeTabs", () => {
  it("renders an accessible tablist with all modes", () => {
    render(<TabsHarness />);

    expect(screen.getByRole("tablist", { name: /assistant modes/i })).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(5);
    expect(
      screen.getByRole("tab", { name: /present me summary/i }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("updates aria-selected on click", async () => {
    const user = userEvent.setup();
    render(<TabsHarness />);

    await user.click(screen.getByRole("tab", { name: /help me/i }));

    expect(screen.getByRole("tab", { name: /help me/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("tab", { name: /present me summary/i }),
    ).toHaveAttribute("aria-selected", "false");
  });

  it("supports keyboard navigation between tabs", async () => {
    const user = userEvent.setup();
    render(<TabsHarness />);

    const summary = screen.getByRole("tab", { name: /present me summary/i });
    summary.focus();
    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("tab", { name: /talk to me/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
