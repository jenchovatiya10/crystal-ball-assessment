"use client";

import type { FormEvent, KeyboardEvent } from "react";

type ComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  isStreaming: boolean;
  placeholder?: string;
  inputId?: string;
};

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  isStreaming,
  placeholder = "Message the assistant…",
  inputId = "composer-input",
}: ComposerProps) {
  const canSend = value.trim().length > 0 && !isStreaming;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSend) return;
    onSend();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend) onSend();
    }
  }

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <label className="composer-label" htmlFor={inputId}>
        Message
      </label>
      <textarea
        id={inputId}
        className="composer-input"
        name="message"
        rows={3}
        value={value}
        placeholder={placeholder}
        disabled={isStreaming}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        aria-label="Message"
      />
      <div className="composer-actions">
        {isStreaming ? (
          <button
            type="button"
            className="composer-stop"
            onClick={onStop}
            aria-label="Stop generating"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            className="composer-send"
            disabled={!canSend}
            aria-label="Send message"
          >
            Send
          </button>
        )}
      </div>
    </form>
  );
}
