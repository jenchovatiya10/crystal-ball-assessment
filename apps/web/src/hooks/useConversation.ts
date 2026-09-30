"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiClientError,
  streamChat,
  streamTeach,
} from "@/lib/apiClient";
import type { ParsedSseEvent } from "@/lib/sseParser";
import {
  createConversationMessage,
  selectFallbackForMode,
  selectInterruptedForMode,
  selectMessagesForMode,
  selectSessionId,
  selectStatusForMode,
  useConversationStore,
} from "@/store/conversationStore";
import { selectActiveMode, useUiStore } from "@/store/uiStore";

export type ConversationStreamMode = "talk" | "teach";

export type ConversationStreamMeta = {
  sessionId?: string;
  requestId?: string;
};

export type ConversationStreamError = {
  code: string;
  message: string;
};

export type UseConversationResult = {
  mode: ConversationStreamMode;
  sessionId: string;
  messages: ReturnType<ReturnType<typeof selectMessagesForMode>>;
  status: ReturnType<ReturnType<typeof selectStatusForMode>>;
  interrupted: boolean;
  fallback: boolean;
  isStreaming: boolean;
  meta: ConversationStreamMeta | null;
  error: ConversationStreamError | null;
  sendMessage: (text: string) => Promise<void>;
  stop: () => void;
};

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof Error && error.name === "AbortError") return true;
  return false;
}

function tokenText(data: unknown): string {
  if (
    typeof data === "object" &&
    data !== null &&
    "t" in data &&
    typeof (data as { t: unknown }).t === "string"
  ) {
    return (data as { t: string }).t;
  }
  return "";
}

function isFallbackPayload(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    "fallback" in data &&
    (data as { fallback: unknown }).fallback === true
  );
}

function parseMeta(data: unknown): ConversationStreamMeta {
  if (typeof data !== "object" || data === null) return {};
  const record = data as { sessionId?: unknown; requestId?: unknown };
  const meta: ConversationStreamMeta = {};
  if (typeof record.sessionId === "string") meta.sessionId = record.sessionId;
  if (typeof record.requestId === "string") meta.requestId = record.requestId;
  return meta;
}

function parseStreamError(data: unknown): ConversationStreamError {
  if (typeof data !== "object" || data === null) {
    return { code: "STREAM_ERROR", message: "Stream failed" };
  }
  const record = data as { code?: unknown; message?: unknown };
  return {
    code: typeof record.code === "string" ? record.code : "STREAM_ERROR",
    message:
      typeof record.message === "string" ? record.message : "Stream failed",
  };
}

function clearAbortController(): void {
  useConversationStore.setState({ abortController: null });
}

function streamForMode(
  mode: ConversationStreamMode,
): typeof streamChat {
  return mode === "talk" ? streamChat : streamTeach;
}

/**
 * Single orchestration point for Talk / Teach.
 * Composer → useConversation → apiClient → SSE parser → Zustand → React
 */
export function useConversation(
  mode: ConversationStreamMode,
): UseConversationResult {
  const sessionId = useConversationStore(selectSessionId);
  const messages = useConversationStore(selectMessagesForMode(mode));
  const status = useConversationStore(selectStatusForMode(mode));
  const interrupted = useConversationStore(selectInterruptedForMode(mode));
  const fallback = useConversationStore(selectFallbackForMode(mode));
  const activeMode = useUiStore(selectActiveMode);

  const [meta, setMeta] = useState<ConversationStreamMeta | null>(null);
  const [error, setError] = useState<ConversationStreamError | null>(null);

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const generationRef = useRef(0);

  const interruptActiveStream = useCallback((targetMode: ConversationStreamMode) => {
    const store = useConversationStore.getState();
    if (store.statusByMode[targetMode] !== "streaming") {
      return false;
    }
    generationRef.current += 1;
    store.abortStream();
    store.markInterrupted(targetMode);
    store.patchLastAssistant(targetMode, { interrupted: true });
    return true;
  }, []);

  const stop = useCallback(() => {
    interruptActiveStream(modeRef.current);
  }, [interruptActiveStream]);

  // Abort on mode switch (active tab left this conversation mode).
  useEffect(() => {
    if (activeMode !== mode) {
      interruptActiveStream(mode);
    }
  }, [activeMode, mode, interruptActiveStream]);

  // Abort on unmount / mode prop change.
  useEffect(() => {
    const hookedMode = mode;
    return () => {
      interruptActiveStream(hookedMode);
    };
  }, [mode, interruptActiveStream]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const generation = ++generationRef.current;
      const store = useConversationStore.getState();
      const currentSessionId = store.ensureSessionId();

      setError(null);
      setMeta(null);

      store.appendMessage(
        mode,
        createConversationMessage("user", trimmed),
      );
      const signal = store.beginStream(mode);
      store.appendMessage(
        mode,
        createConversationMessage("assistant", ""),
      );

      let assistantContent = "";

      try {
        const stream = streamForMode(mode)({
          sessionId: currentSessionId,
          message: trimmed,
          signal,
        });

        for await (const event of stream as AsyncIterable<ParsedSseEvent>) {
          if (generation !== generationRef.current) {
            return;
          }
          if (signal.aborted) {
            break;
          }

          if (event.event === "meta") {
            setMeta(parseMeta(event.data));
            continue;
          }

          if (event.event === "token") {
            assistantContent += tokenText(event.data);
            useConversationStore
              .getState()
              .patchLastAssistant(mode, { content: assistantContent });
            continue;
          }

          if (event.event === "done") {
            const usedFallback = isFallbackPayload(event.data);
            const latest = useConversationStore.getState();
            if (usedFallback) {
              latest.markFallback(mode);
              latest.patchLastAssistant(mode, {
                content: assistantContent,
                fallback: true,
              });
            }
            latest.setStatus(mode, "idle");
            clearAbortController();
            return;
          }

          if (event.event === "error") {
            const parsed = parseStreamError(event.data);
            setError(parsed);
            const latest = useConversationStore.getState();
            if (isFallbackPayload(event.data)) {
              latest.markFallback(mode);
              latest.patchLastAssistant(mode, {
                content: assistantContent,
                fallback: true,
              });
            }
            latest.setStatus(mode, "error");
            clearAbortController();
            return;
          }
        }

        if (generation !== generationRef.current) {
          return;
        }

        if (signal.aborted) {
          const latest = useConversationStore.getState();
          if (!latest.interruptedByMode[mode]) {
            latest.markInterrupted(mode);
            latest.patchLastAssistant(mode, {
              content: assistantContent,
              interrupted: true,
            });
          }
          return;
        }

        useConversationStore.getState().setStatus(mode, "idle");
        clearAbortController();
      } catch (err) {
        if (generation !== generationRef.current) {
          return;
        }

        if (isAbortError(err) || signal.aborted) {
          const latest = useConversationStore.getState();
          if (!latest.interruptedByMode[mode]) {
            latest.markInterrupted(mode);
            latest.patchLastAssistant(mode, {
              content: assistantContent,
              interrupted: true,
            });
          }
          return;
        }

        const streamError: ConversationStreamError =
          err instanceof ApiClientError
            ? { code: err.code, message: err.message }
            : {
                code: "CLIENT_ERROR",
                message:
                  err instanceof Error ? err.message : "Request failed",
              };
        setError(streamError);
        const latest = useConversationStore.getState();
        latest.setStatus(mode, "error");
        latest.patchLastAssistant(mode, {
          content: assistantContent || streamError.message,
        });
        clearAbortController();
      }
    },
    [mode],
  );

  return {
    mode,
    sessionId,
    messages,
    status,
    interrupted,
    fallback,
    isStreaming: status === "streaming",
    meta,
    error,
    sendMessage,
    stop,
  };
}
