import { create } from "zustand";

type AppShellState = {
  ready: boolean;
  markReady: () => void;
};

/**
 * Minimal Zustand store to verify workspace wiring.
 * Feature state will be added later.
 */
export const useAppShellStore = create<AppShellState>((set) => ({
  ready: false,
  markReady: () => set({ ready: true }),
}));
