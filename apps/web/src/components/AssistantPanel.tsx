"use client";

import { useEffect } from "react";
import type { Approval } from "@crystal-ball/shared";
import { ChatView } from "@/components/ChatView";
import { GreetingBar } from "@/components/GreetingBar";
import { HelpView } from "@/components/HelpView";
import { ModeTabs } from "@/components/ModeTabs";
import { SummaryView } from "@/components/SummaryView";
import type { AssistantMode } from "@/lib/assistant-modes";
import {
  selectSessionId,
  useConversationStore,
} from "@/store/conversationStore";
import {
  selectActiveMode,
  selectPanelOpen,
  selectSetActiveMode,
  selectTogglePanel,
  useUiStore,
} from "@/store/uiStore";

type AssistantPanelProps = {
  approvals: Approval[];
};

function ModeStage({ mode }: { mode: AssistantMode }) {
  switch (mode) {
    case "summary":
      return <SummaryView />;
    case "talk":
      return <ChatView mode="talk" />;
    case "help":
      return <HelpView />;
    case "teach":
      return <ChatView mode="teach" />;
    case "greeting":
      return <GreetingBar />;
  }
}

/**
 * Client shell for all five assistant modes.
 * Mode + panel chrome live in Zustand — no prop drilling of session/stream state.
 * Talk/Teach share ChatView; stream abort on mode switch/unmount is owned by useConversation.
 */
export function AssistantPanel({ approvals }: AssistantPanelProps) {
  const activeMode = useUiStore(selectActiveMode);
  const setActiveMode = useUiStore(selectSetActiveMode);
  const panelOpen = useUiStore(selectPanelOpen);
  const togglePanel = useUiStore(selectTogglePanel);
  const sessionId = useConversationStore(selectSessionId);
  const ensureSessionId = useConversationStore((s) => s.ensureSessionId);

  useEffect(() => {
    ensureSessionId();
  }, [ensureSessionId]);

  return (
    <section className="assistant-panel" aria-label="Crystal Ball assistant">
      <header className="assistant-header">
        <div>
          <p className="assistant-kicker">Command centre</p>
          <h1 className="assistant-title">Crystal Ball</h1>
          {sessionId ? (
            <p className="session-id" title={sessionId}>
              Session {sessionId.slice(0, 8)}
            </p>
          ) : null}
        </div>
        <div className="assistant-header-actions">
          <button
            type="button"
            className="panel-toggle"
            aria-pressed={panelOpen}
            onClick={togglePanel}
          >
            {panelOpen ? "Hide panel" : "Show panel"}
          </button>
          <div className="approval-count" aria-live="polite">
            <span className="approval-count-value">{approvals.length}</span>
            <span className="approval-count-label">approvals loaded</span>
          </div>
        </div>
      </header>

      {panelOpen ? (
        <>
          <ModeTabs activeMode={activeMode} onModeChange={setActiveMode} />

          <div
            role="tabpanel"
            id={`panel-${activeMode}`}
            aria-labelledby={`tab-${activeMode}`}
            className="assistant-stage"
          >
            <ModeStage mode={activeMode} />

            <aside className="approval-rail" aria-label="Seeded approvals">
              <h3>Queue snapshot</h3>
              {approvals.length === 0 ? (
                <p className="approval-empty">
                  No approvals available. Start the API or check
                  NEXT_PUBLIC_API_URL.
                </p>
              ) : (
                <ul className="approval-list">
                  {approvals.map((approval) => (
                    <li key={approval.id} className="approval-item">
                      <span className="approval-type">{approval.type}</span>
                      <span className="approval-title">{approval.title}</span>
                      <span className="approval-due">
                        Due {approval.dueAt.slice(0, 10)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </aside>
          </div>
        </>
      ) : (
        <p className="panel-collapsed-note">
          Assistant panel hidden. Local composer drafts are unaffected.
        </p>
      )}
    </section>
  );
}
