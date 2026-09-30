import { create } from "zustand";
import type { AssistantMode } from "@/lib/assistant-modes";

type UiState = {
  panelOpen: boolean;
  activeMode: AssistantMode;
  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;
  setActiveMode: (mode: AssistantMode) => void;
};

export const useUiStore = create<UiState>((set) => ({
  panelOpen: true,
  activeMode: "summary",
  setPanelOpen: (open) => set({ panelOpen: open }),
  togglePanel: () => set((state) => ({ panelOpen: !state.panelOpen })),
  setActiveMode: (mode) => set({ activeMode: mode }),
}));

/** Narrow selectors — avoid subscribing to the whole UI store. */
export const selectPanelOpen = (state: UiState) => state.panelOpen;
export const selectActiveMode = (state: UiState) => state.activeMode;
export const selectSetActiveMode = (state: UiState) => state.setActiveMode;
export const selectTogglePanel = (state: UiState) => state.togglePanel;
