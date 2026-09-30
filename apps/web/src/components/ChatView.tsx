"use client";

import { useState } from "react";
import { Composer } from "@/components/Composer";
import { MessageList } from "@/components/MessageList";
import {
  useConversation,
  type ConversationStreamMode,
} from "@/hooks/useConversation";
import { ASSISTANT_MODES } from "@/lib/assistant-modes";

type ChatViewProps = {
  mode: ConversationStreamMode;
};

/**
 * Shared Talk / Teach conversation UI.
 * Orchestration stays in useConversation — this view only renders state.
 */
export function ChatView({ mode }: ChatViewProps) {
  const {
    messages,
    status,
    isStreaming,
    error,
    interrupted,
    fallback,
    sendMessage,
    stop,
  } = useConversation(mode);

  const [draft, setDraft] = useState("");
  const [lastSent, setLastSent] = useState<string | null>(null);

  const modeMeta = ASSISTANT_MODES.find((item) => item.id === mode);
  const showRetry =
    !isStreaming &&
    (status === "error" || interrupted) &&
    Boolean(lastSent || messages.some((message) => message.role === "user"));

  function handleSend() {
    const text = draft.trim();
    if (!text || isStreaming) return;
    setLastSent(text);
    setDraft("");
    void sendMessage(text);
  }

  function handleRetry() {
    if (isStreaming) return;
    const text =
      lastSent ??
      [...messages].reverse().find((message) => message.role === "user")
        ?.content;
    if (!text) return;
    setDraft("");
    void sendMessage(text);
  }

  return (
    <section
      className="chat-view"
      aria-label={modeMeta?.label ?? "Conversation"}
      data-mode={mode}
    >
      <header className="chat-view-header">
        <h2 className="chat-view-title">{modeMeta?.label ?? mode}</h2>
        <p className="chat-view-subtitle">{modeMeta?.description}</p>
      </header>

      <MessageList messages={messages} isStreaming={isStreaming} />

      {error ? (
        <p className="chat-alert chat-alert-error" role="alert">
          {error.message}
        </p>
      ) : null}

      {interrupted && !error ? (
        <p className="chat-alert chat-alert-interrupted" role="alert">
          Response interrupted. You can retry the last message.
        </p>
      ) : null}

      {fallback && !error ? (
        <p className="chat-alert chat-alert-fallback" role="status">
          Showing a fallback response.
        </p>
      ) : null}

      {showRetry ? (
        <div className="chat-retry-row">
          <button
            type="button"
            className="chat-retry"
            onClick={handleRetry}
            aria-label="Retry last message"
          >
            Retry
          </button>
        </div>
      ) : null}

      <Composer
        value={draft}
        onChange={setDraft}
        onSend={handleSend}
        onStop={stop}
        isStreaming={isStreaming}
        inputId={`composer-input-${mode}`}
        placeholder={
          mode === "teach"
            ? "Ask for coaching on a review…"
            : "Ask about the approval queue…"
        }
      />
    </section>
  );
}
