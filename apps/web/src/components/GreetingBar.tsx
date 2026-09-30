"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Language } from "@crystal-ball/shared";
import {
  ApiClientError,
  getGreeting,
  type GreetingApiResponse,
} from "@/lib/apiClient";
import { useConversationStore } from "@/store/conversationStore";

type GreetingStatus = "idle" | "loading" | "success" | "error";

type GreetingBarProps = {
  /** Optional language when the UI exposes language selection. */
  language?: Language;
};

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof Error && error.name === "AbortError") return true;
  return false;
}

/**
 * Deterministic Replay Greeting — GET /api/assistant/greeting only.
 * Never calls an LLM from the browser.
 */
export function GreetingBar({ language }: GreetingBarProps) {
  const ensureSessionId = useConversationStore((state) => state.ensureSessionId);

  const [status, setStatus] = useState<GreetingStatus>("loading");
  const [greeting, setGreeting] = useState<string | null>(null);
  const [meta, setMeta] = useState<GreetingApiResponse["meta"] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const loadGreeting = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus("loading");
    setErrorMessage(null);

    try {
      const sessionId = ensureSessionId();
      const response = await getGreeting({
        sessionId,
        signal: controller.signal,
        ...(language ? { language } : {}),
      });
      if (controller.signal.aborted) return;
      setGreeting(response.greeting);
      setMeta(response.meta);
      setStatus("success");
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) return;
      const message =
        error instanceof ApiClientError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Failed to load greeting";
      setErrorMessage(message);
      setStatus("error");
    }
  }, [ensureSessionId, language]);

  useEffect(() => {
    void loadGreeting();
    return () => {
      abortRef.current?.abort();
    };
  }, [loadGreeting]);

  return (
    <section className="greeting-bar" aria-label="Greeting">
      <p className="greeting-bar-kicker">Live queue pulse</p>
      <h2 className="greeting-bar-title">Replay Greeting</h2>

      {status === "loading" ? (
        <p className="greeting-bar-loading" role="status" aria-live="polite">
          Loading greeting…
        </p>
      ) : null}

      {status === "error" && errorMessage ? (
        <p className="greeting-bar-error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      {status === "success" && greeting ? (
        <div className="greeting-bar-body">
          <p className="greeting-bar-message" data-testid="greeting-message">
            {greeting}
          </p>
          {meta ? (
            <p className="greeting-bar-meta" data-testid="greeting-meta">
              {meta.dayPart}
              {" · "}
              {meta.totalCount} waiting
              {meta.highestPriorityTitle
                ? ` · Top: ${meta.highestPriorityTitle}`
                : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="greeting-bar-actions">
        <button
          type="button"
          className="greeting-replay"
          onClick={() => {
            void loadGreeting();
          }}
          disabled={status === "loading"}
          aria-label="Replay Greeting"
        >
          Replay Greeting
        </button>
      </div>
    </section>
  );
}
