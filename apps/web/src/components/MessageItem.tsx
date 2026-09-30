"use client";

import { memo } from "react";
import type { ConversationMessage } from "@/store/session";

type MessageItemProps = {
  message: ConversationMessage;
};

function MessageItemComponent({ message }: MessageItemProps) {
  const roleLabel = message.role === "user" ? "You" : "Assistant";

  return (
    <article
      className={`message-item message-item-${message.role}`}
      aria-label={
        message.role === "user" ? "Your message" : "Assistant message"
      }
      data-testid={`message-${message.role}`}
    >
      <header className="message-item-header">
        <span className="message-role">{roleLabel}</span>
        {message.interrupted ? (
          <span className="message-badge message-badge-interrupted">
            Interrupted
          </span>
        ) : null}
        {message.fallback ? (
          <span className="message-badge message-badge-fallback">
            Fallback
          </span>
        ) : null}
      </header>
      <p className="message-content">{message.content}</p>
    </article>
  );
}

export const MessageItem = memo(MessageItemComponent);
