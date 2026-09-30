import { beforeEach, describe, expect, it } from "vitest";
import {
  selectActiveMode,
  selectPanelOpen,
  useUiStore,
} from "@/store/uiStore";

describe("useUiStore", () => {
  beforeEach(() => {
    useUiStore.setState({
      panelOpen: true,
      activeMode: "summary",
    });
  });

  it("defaults to summary mode with panel open", () => {
    const state = useUiStore.getState();
    expect(selectActiveMode(state)).toBe("summary");
    expect(selectPanelOpen(state)).toBe(true);
  });

  it("updates activeMode without resetting panelOpen", () => {
    useUiStore.getState().setActiveMode("help");
    expect(useUiStore.getState().activeMode).toBe("help");
    expect(useUiStore.getState().panelOpen).toBe(true);
  });

  it("toggles panelOpen independently of mode", () => {
    useUiStore.getState().setActiveMode("teach");
    useUiStore.getState().togglePanel();
    expect(useUiStore.getState().panelOpen).toBe(false);
    expect(useUiStore.getState().activeMode).toBe("teach");
    useUiStore.getState().setPanelOpen(true);
    expect(useUiStore.getState().panelOpen).toBe(true);
  });
});
