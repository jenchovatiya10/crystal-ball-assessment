import type { AssistantMode } from "@/lib/assistant-modes";

export const SESSION_STORAGE_KEY = "crystal-ball.sessionId";

/** Create or restore a stable browser-tab session id. */
export function getOrCreateSessionId(
  storage: Pick<Storage, "getItem" | "setItem"> | null = typeof window !== "undefined"
    ? window.sessionStorage
    : null,
  randomUUID: () => string = () => crypto.randomUUID(),
): string {
  if (!storage) {
    return randomUUID();
  }
  const existing = storage.getItem(SESSION_STORAGE_KEY);
  if (existing && existing.length > 0) {
    return existing;
  }
  const id = randomUUID();
  storage.setItem(SESSION_STORAGE_KEY, id);
  return id;
}

export type ConversationStatus = "idle" | "streaming" | "error";

export type ConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  interrupted?: boolean;
  fallback?: boolean;
};

export type ModeMessages = Record<AssistantMode, ConversationMessage[]>;
export type ModeStatus = Record<AssistantMode, ConversationStatus>;
export type ModeFlags = Record<AssistantMode, boolean>;

export function emptyModeMessages(): ModeMessages {
  return {
    summary: [],
    talk: [],
    help: [],
    teach: [],
    greeting: [],
  };
}

export function idleModeStatus(): ModeStatus {
  return {
    summary: "idle",
    talk: "idle",
    help: "idle",
    teach: "idle",
    greeting: "idle",
  };
}

export function falseModeFlags(): ModeFlags {
  return {
    summary: false,
    talk: false,
    help: false,
    teach: false,
    greeting: false,
  };
}
