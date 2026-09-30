"use client";

import type { ConversationMessage } from "@/store/session";
import { MessageItem } from "@/components/MessageItem";

type MessageListProps = {
  messages: ConversationMessage[];
  isStreaming: boolean;
  emptyLabel?: string;
};

export function MessageList({
  messages,
  isStreaming,
  emptyLabel = "No messages yet. Ask about the approval queue.",
}: MessageListProps) {
  return (
    <div
      className="message-list"
      aria-live="polite"
      aria-relevant="additions text"
      aria-busy={isStreaming}
    >
      {messages.length === 0 && !isStreaming ? (
        <p className="message-list-empty">{emptyLabel}</p>
      ) : null}

      {messages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}

      {isStreaming ? (
        <p className="message-loading" role="status">
          Generating response…
        </p>
      ) : null}
    </div>
  );
}
