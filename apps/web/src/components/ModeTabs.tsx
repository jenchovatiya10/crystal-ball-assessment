"use client";

import type { KeyboardEvent } from "react";
import {
  ASSISTANT_MODES,
  type AssistantMode,
} from "@/lib/assistant-modes";

type ModeTabsProps = {
  activeMode: AssistantMode;
  onModeChange: (mode: AssistantMode) => void;
};

export function ModeTabs({ activeMode, onModeChange }: ModeTabsProps) {
  const modes = ASSISTANT_MODES;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const currentIndex = modes.findIndex((mode) => mode.id === activeMode);
    if (currentIndex < 0) return;

    let nextIndex = currentIndex;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      nextIndex = (currentIndex + 1) % modes.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      nextIndex = (currentIndex - 1 + modes.length) % modes.length;
    } else if (event.key === "Home") {
      event.preventDefault();
      nextIndex = 0;
    } else if (event.key === "End") {
      event.preventDefault();
      nextIndex = modes.length - 1;
    } else {
      return;
    }

    const next = modes[nextIndex];
    if (next) onModeChange(next.id);
  }

  return (
    <div
      role="tablist"
      aria-label="Assistant modes"
      className="mode-tabs"
      onKeyDown={onKeyDown}
    >
      {modes.map((mode) => {
        const selected = mode.id === activeMode;
        return (
          <button
            key={mode.id}
            type="button"
            role="tab"
            id={`tab-${mode.id}`}
            aria-selected={selected}
            aria-controls={`panel-${mode.id}`}
            tabIndex={selected ? 0 : -1}
            className={selected ? "mode-tab mode-tab-active" : "mode-tab"}
            onClick={() => onModeChange(mode.id)}
          >
            <span className="mode-tab-label">{mode.label}</span>
            <span className="mode-tab-desc">{mode.description}</span>
          </button>
        );
      })}
    </div>
  );
}
