import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SESSION_STORAGE_KEY,
  getOrCreateSessionId,
} from "@/store/session";
import {
  createConversationMessage,
  selectMessagesForMode,
  selectStatusForMode,
  useConversationStore,
} from "@/store/conversationStore";

describe("getOrCreateSessionId", () => {
  it("reuses a persisted session id from sessionStorage", () => {
    const storage = {
      getItem: vi.fn(() => "persisted-id"),
      setItem: vi.fn(),
    };
    const id = getOrCreateSessionId(storage, () => "new-id");
    expect(id).toBe("persisted-id");
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("creates and persists a new uuid when missing", () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    };
    const id = getOrCreateSessionId(storage, () => "fresh-uuid");
    expect(id).toBe("fresh-uuid");
    expect(storage.setItem).toHaveBeenCalledWith(
      SESSION_STORAGE_KEY,
      "fresh-uuid",
    );
  });
});

describe("useConversationStore", () => {
  beforeEach(() => {
    useConversationStore.setState({
      sessionId: "",
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
    sessionStorage.clear();
  });

  it("ensures a session id and persists it", () => {
    const id = useConversationStore.getState().ensureSessionId();
    expect(id.length).toBeGreaterThan(0);
    expect(useConversationStore.getState().sessionId).toBe(id);
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBe(id);
    expect(useConversationStore.getState().ensureSessionId()).toBe(id);
  });

  it("keeps mode-specific messages isolated", () => {
    const { appendMessage } = useConversationStore.getState();
    appendMessage("talk", createConversationMessage("user", "hello talk"));
    appendMessage("teach", createConversationMessage("user", "hello teach"));

    const state = useConversationStore.getState();
    expect(selectMessagesForMode("talk")(state)).toHaveLength(1);
    expect(selectMessagesForMode("teach")(state)).toHaveLength(1);
    expect(selectMessagesForMode("talk")(state)[0]?.content).toBe("hello talk");
    expect(selectMessagesForMode("help")(state)).toEqual([]);
  });

  it("tracks streaming status and abort controller lifecycle", () => {
    const signal = useConversationStore.getState().beginStream("talk");
    expect(selectStatusForMode("talk")(useConversationStore.getState())).toBe(
      "streaming",
    );
    expect(signal.aborted).toBe(false);
    expect(useConversationStore.getState().abortController).not.toBeNull();

    useConversationStore.getState().abortStream();
    expect(signal.aborted).toBe(true);
    expect(useConversationStore.getState().abortController).toBeNull();
  });

  it("marks interrupted and fallback flags per mode", () => {
    useConversationStore.getState().beginStream("talk");
    useConversationStore.getState().markInterrupted("talk");
    useConversationStore.getState().markFallback("teach");

    const state = useConversationStore.getState();
    expect(state.interruptedByMode.talk).toBe(true);
    expect(state.statusByMode.talk).toBe("error");
    expect(state.fallbackByMode.teach).toBe(true);
    expect(state.interruptedByMode.teach).toBe(false);
  });

  it("patches the last assistant message without touching earlier turns", () => {
    const { appendMessage, patchLastAssistant } = useConversationStore.getState();
    appendMessage("talk", createConversationMessage("user", "q"));
    appendMessage("talk", createConversationMessage("assistant", "partial"));
    patchLastAssistant("talk", {
      content: "partial...",
      interrupted: true,
    });

    const messages = selectMessagesForMode("talk")(useConversationStore.getState());
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      role: "assistant",
      content: "partial...",
      interrupted: true,
    });
    expect(messages[0]?.content).toBe("q");
  });
});
