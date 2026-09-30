"use client";

import { useState } from "react";
import type { Approval } from "@crystal-ball/shared";
import { GreetingBar } from "@/components/GreetingBar";
import { ModeTabs } from "@/components/ModeTabs";
import {
  ASSISTANT_MODES,
  type AssistantMode,
} from "@/lib/assistant-modes";

type AssistantPanelProps = {
  approvals: Approval[];
};

function ModePlaceholder({ mode }: { mode: AssistantMode }) {
  const meta = ASSISTANT_MODES.find((item) => item.id === mode);

  if (mode === "greeting") {
    return <GreetingBar />;
  }

  return (
    <div className="mode-placeholder">
      <h2>{meta?.label ?? mode}</h2>
      <p>{meta?.description}</p>
      <p className="mode-placeholder-note">
        Interaction and streaming for this mode will be wired in a later step.
      </p>
    </div>
  );
}

/**
 * Client shell for mode switching. Keeps the client boundary small —
 * no ranking, RAG, prompts, or streaming logic.
 */
export function AssistantPanel({ approvals }: AssistantPanelProps) {
  const [activeMode, setActiveMode] = useState<AssistantMode>("summary");

  return (
    <section className="assistant-panel" aria-label="Crystal Ball assistant">
      <header className="assistant-header">
        <div>
          <p className="assistant-kicker">Command centre</p>
          <h1 className="assistant-title">Crystal Ball</h1>
        </div>
        <div className="approval-count" aria-live="polite">
          <span className="approval-count-value">{approvals.length}</span>
          <span className="approval-count-label">approvals loaded</span>
        </div>
      </header>

      <ModeTabs activeMode={activeMode} onModeChange={setActiveMode} />

      <div
        role="tabpanel"
        id={`panel-${activeMode}`}
        aria-labelledby={`tab-${activeMode}`}
        className="assistant-stage"
      >
        <ModePlaceholder mode={activeMode} />

        <aside className="approval-rail" aria-label="Seeded approvals">
          <h3>Queue snapshot</h3>
          {approvals.length === 0 ? (
            <p className="approval-empty">
              No approvals available. Start the API or check NEXT_PUBLIC_API_URL.
            </p>
          ) : (
            <ul className="approval-list">
              {approvals.map((approval) => (
                <li key={approval.id} className="approval-item">
                  <span className="approval-type">{approval.type}</span>
                  <span className="approval-title">{approval.title}</span>
                  <span className="approval-due">Due {approval.dueAt.slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </section>
  );
}
