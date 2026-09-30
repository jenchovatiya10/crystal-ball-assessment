import { create } from "zustand";
import type { AssistantMode } from "@/lib/assistant-modes";
import {
  emptyModeMessages,
  falseModeFlags,
  getOrCreateSessionId,
  idleModeStatus,
  type ConversationMessage,
  type ConversationStatus,
  type ModeFlags,
  type ModeMessages,
  type ModeStatus,
} from "@/store/session";

type ConversationState = {
  sessionId: string;
  messagesByMode: ModeMessages;
  statusByMode: ModeStatus;
  interruptedByMode: ModeFlags;
  fallbackByMode: ModeFlags;
  abortController: AbortController | null;

  ensureSessionId: () => string;
  resetSession: () => void;
  setStatus: (mode: AssistantMode, status: ConversationStatus) => void;
  appendMessage: (mode: AssistantMode, message: ConversationMessage) => void;
  patchLastAssistant: (
    mode: AssistantMode,
    patch: Partial<Pick<ConversationMessage, "content" | "interrupted" | "fallback">>,
  ) => void;
  beginStream: (mode: AssistantMode) => AbortSignal;
  abortStream: () => void;
  markInterrupted: (mode: AssistantMode) => void;
  markFallback: (mode: AssistantMode) => void;
  clearTransientFlags: (mode: AssistantMode) => void;
};

function createMessageId(): string {
  return crypto.randomUUID();
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  sessionId: "",
  messagesByMode: emptyModeMessages(),
  statusByMode: idleModeStatus(),
  interruptedByMode: falseModeFlags(),
  fallbackByMode: falseModeFlags(),
  abortController: null,

  ensureSessionId: () => {
    const current = get().sessionId;
    if (current) return current;
    const sessionId = getOrCreateSessionId();
    set({ sessionId });
    return sessionId;
  },

  resetSession: () => {
    const previous = get().abortController;
    previous?.abort();
    const sessionId = getOrCreateSessionId();
    set({
      sessionId,
      messagesByMode: emptyModeMessages(),
      statusByMode: idleModeStatus(),
      interruptedByMode: falseModeFlags(),
      fallbackByMode: falseModeFlags(),
      abortController: null,
    });
  },

  setStatus: (mode, status) => {
    set((state) => ({
      statusByMode: { ...state.statusByMode, [mode]: status },
    }));
  },

  appendMessage: (mode, message) => {
    set((state) => ({
      messagesByMode: {
        ...state.messagesByMode,
        [mode]: [...state.messagesByMode[mode], message],
      },
    }));
  },

  patchLastAssistant: (mode, patch) => {
    set((state) => {
      const messages = state.messagesByMode[mode];
      if (messages.length === 0) return state;
      const lastIndex = messages.length - 1;
      const last = messages[lastIndex];
      if (!last || last.role !== "assistant") return state;
      const next = messages.slice();
      next[lastIndex] = { ...last, ...patch };
      return {
        messagesByMode: {
          ...state.messagesByMode,
          [mode]: next,
        },
      };
    });
  },

  beginStream: (mode) => {
    const existing = get().abortController;
    existing?.abort();
    const abortController = new AbortController();
    set((state) => ({
      abortController,
      statusByMode: { ...state.statusByMode, [mode]: "streaming" },
      interruptedByMode: { ...state.interruptedByMode, [mode]: false },
      fallbackByMode: { ...state.fallbackByMode, [mode]: false },
    }));
    return abortController.signal;
  },

  abortStream: () => {
    const controller = get().abortController;
    controller?.abort();
    set({ abortController: null });
  },

  markInterrupted: (mode) => {
    set((state) => ({
      interruptedByMode: { ...state.interruptedByMode, [mode]: true },
      statusByMode: { ...state.statusByMode, [mode]: "error" },
      abortController: null,
    }));
  },

  markFallback: (mode) => {
    set((state) => ({
      fallbackByMode: { ...state.fallbackByMode, [mode]: true },
    }));
  },

  clearTransientFlags: (mode) => {
    set((state) => ({
      interruptedByMode: { ...state.interruptedByMode, [mode]: false },
      fallbackByMode: { ...state.fallbackByMode, [mode]: false },
    }));
  },
}));

/** Narrow selectors — subscribe only to the slice you need. */
export const selectSessionId = (state: ConversationState) => state.sessionId;
export const selectAbortController = (state: ConversationState) =>
  state.abortController;
export const selectMessagesForMode =
  (mode: AssistantMode) => (state: ConversationState) =>
    state.messagesByMode[mode];
export const selectStatusForMode =
  (mode: AssistantMode) => (state: ConversationState) =>
    state.statusByMode[mode];
export const selectInterruptedForMode =
  (mode: AssistantMode) => (state: ConversationState) =>
    state.interruptedByMode[mode];
export const selectFallbackForMode =
  (mode: AssistantMode) => (state: ConversationState) =>
    state.fallbackByMode[mode];

export function createConversationMessage(
  role: ConversationMessage["role"],
  content: string,
  extras: Partial<Pick<ConversationMessage, "interrupted" | "fallback">> = {},
): ConversationMessage {
  return {
    id: createMessageId(),
    role,
    content,
    ...extras,
  };
}
