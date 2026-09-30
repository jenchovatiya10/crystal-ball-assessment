"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { HelpResponse } from "@crystal-ball/shared";
import {
  ApiClientError,
  getHelp,
  type HelpApiResponse,
} from "@/lib/apiClient";
import { useConversationStore } from "@/store/conversationStore";

type HelpStatus = "idle" | "loading" | "success" | "error";

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof Error && error.name === "AbortError") return true;
  return false;
}

/**
 * Help Me — asks the backend RAG endpoint only.
 * No client-side retrieval and no Anthropic calls from the browser.
 */
export function HelpView() {
  const ensureSessionId = useConversationStore((state) => state.ensureSessionId);

  const [question, setQuestion] = useState("");
  const [status, setStatus] = useState<HelpStatus>("idle");
  const [result, setResult] = useState<HelpApiResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || status === "loading") return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus("loading");
    setErrorMessage(null);
    setResult(null);

    try {
      const sessionId = ensureSessionId();
      const response = await getHelp({
        sessionId,
        question: trimmed,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setResult(response);
      setStatus("success");
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) return;
      const message =
        error instanceof ApiClientError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Failed to get help";
      setResult(null);
      setErrorMessage(message);
      setStatus("error");
    }
  }

  return (
    <section className="help-view" aria-label="Help me">
      <header className="help-view-header">
        <h2 className="help-view-title">Help me</h2>
        <p className="help-view-subtitle">Policy-grounded answers</p>
      </header>

      <form className="help-form" onSubmit={handleSubmit}>
        <label className="help-label" htmlFor="help-question">
          Policy question
        </label>
        <textarea
          id="help-question"
          className="help-input"
          name="question"
          rows={3}
          value={question}
          placeholder="Ask about escalation, SLA, rejection notes…"
          disabled={status === "loading"}
          onChange={(event) => setQuestion(event.target.value)}
          aria-label="Policy question"
        />
        <div className="help-form-actions">
          <button
            type="submit"
            className="help-submit"
            disabled={status === "loading" || question.trim().length === 0}
            aria-label="Submit help question"
          >
            Ask
          </button>
        </div>
      </form>

      {status === "loading" ? (
        <p className="help-loading" role="status" aria-live="polite">
          Looking up policy guidance…
        </p>
      ) : null}

      {status === "error" && errorMessage ? (
        <p className="help-alert help-alert-error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      {status === "success" && result ? (
        <HelpResult data={result.data} meta={result.meta} />
      ) : null}
    </section>
  );
}

type HelpResultProps = {
  data: HelpResponse;
  meta: HelpApiResponse["meta"];
};

function HelpResult({ data, meta }: HelpResultProps) {
  const isFallback = meta.source === "fallback";
  const isNoAnswer = !data.grounded;

  return (
    <div className="help-result">
      {isFallback ? (
        <p
          className="help-fallback-banner"
          role="status"
          data-testid="help-fallback-indicator"
        >
          Basic mode
          {meta.reason
            ? ` — ${meta.reason}`
            : " — showing deterministic policy fallback"}
        </p>
      ) : null}

      <p
        className={
          data.grounded
            ? "help-grounded help-grounded-yes"
            : "help-grounded help-grounded-no"
        }
        data-testid="help-grounded-indicator"
        role="status"
      >
        {data.grounded
          ? "Grounded in retrieved policy"
          : "Not grounded — current policy does not contain enough information"}
      </p>

      {isNoAnswer ? (
        <div className="help-no-answer" data-testid="help-no-answer">
          <h3 className="help-section-title">No policy answer</h3>
          <p className="help-answer-text">
            {data.answer ||
              "The current policy does not contain enough information to answer this question."}
          </p>
        </div>
      ) : (
        <section className="help-answer" aria-label="Help answer">
          <h3 className="help-section-title">Answer</h3>
          <p className="help-answer-text">{data.answer}</p>
        </section>
      )}

      {data.sources.length > 0 ? (
        <section className="help-sources" aria-label="Policy sources">
          <h3 className="help-section-title">Sources</h3>
          <ul className="help-source-list">
            {data.sources.map((source) => (
              <li key={source} className="help-source-item">
                {source}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="help-sources-empty" data-testid="help-sources-empty">
          No source IDs returned.
        </p>
      )}
    </div>
  );
}
