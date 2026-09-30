"use client";

import { useEffect, useState } from "react";
import type { Priority, SummaryResponse } from "@crystal-ball/shared";
import {
  ApiClientError,
  getSummary,
  type SummaryApiResponse,
} from "@/lib/apiClient";
import { useConversationStore } from "@/store/conversationStore";

type SummaryStatus = "loading" | "success" | "error";

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof Error && error.name === "AbortError") return true;
  return false;
}

function priorityClass(priority: Priority): string {
  return `summary-priority-badge summary-priority-${priority}`;
}

/**
 * Present Me Summary — fetches validated backend output only.
 * Ranking stays on the server; this view keeps result state locally.
 */
export function SummaryView() {
  const ensureSessionId = useConversationStore((state) => state.ensureSessionId);

  const [status, setStatus] = useState<SummaryStatus>("loading");
  const [result, setResult] = useState<SummaryApiResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function load() {
      setStatus("loading");
      setErrorMessage(null);

      try {
        const sessionId = ensureSessionId();
        const response = await getSummary({
          sessionId,
          signal: controller.signal,
        });
        if (cancelled) return;
        setResult(response);
        setStatus("success");
      } catch (error) {
        if (cancelled || isAbortError(error) || controller.signal.aborted) {
          return;
        }
        const message =
          error instanceof ApiClientError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Failed to load summary";
        setResult(null);
        setErrorMessage(message);
        setStatus("error");
      }
    }

    void load();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [ensureSessionId]);

  return (
    <section className="summary-view" aria-label="Present me Summary">
      <header className="summary-view-header">
        <h2 className="summary-view-title">Present me Summary</h2>
        <p className="summary-view-subtitle">
          Ranked overview of waiting approvals
        </p>
      </header>

      {status === "loading" ? (
        <p className="summary-loading" role="status" aria-live="polite">
          Loading summary…
        </p>
      ) : null}

      {status === "error" && errorMessage ? (
        <p className="summary-alert summary-alert-error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      {status === "success" && result ? (
        <SummaryResult data={result.data} meta={result.meta} />
      ) : null}
    </section>
  );
}

type SummaryResultProps = {
  data: SummaryResponse;
  meta: SummaryApiResponse["meta"];
};

function SummaryResult({ data, meta }: SummaryResultProps) {
  const isFallback = meta.source === "fallback";

  return (
    <div className="summary-result">
      {isFallback ? (
        <p
          className="summary-fallback-banner"
          role="status"
          data-testid="summary-fallback-indicator"
        >
          Basic mode
          {meta.reason
            ? ` — ${meta.reason}`
            : " — showing deterministic fallback summary"}
        </p>
      ) : null}

      <section className="summary-overview" aria-label="Overview">
        <h3 className="summary-section-title">Overview</h3>
        <p className="summary-overview-text">{data.overview}</p>
      </section>

      <section className="summary-priority-list" aria-label="Priority items">
        <h3 className="summary-section-title">Priority items</h3>
        {data.priorityItems.length === 0 ? (
          <p className="summary-empty">No priority items returned.</p>
        ) : (
          <ol className="summary-priority-items">
            {data.priorityItems.map((item) => (
              <li key={item.approvalId} className="summary-priority-item">
                <div className="summary-priority-item-header">
                  <span className="summary-approval-id">{item.approvalId}</span>
                  <span
                    className={priorityClass(item.priority)}
                    data-testid={`priority-badge-${item.approvalId}`}
                  >
                    {item.priority}
                  </span>
                </div>
                <p className="summary-priority-reason">{item.reason}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section
        className="summary-next-action"
        aria-label="Recommended next action"
      >
        <h3 className="summary-section-title">Recommended next action</h3>
        <p className="summary-next-action-text">{data.recommendedNextAction}</p>
      </section>
    </div>
  );
}
