export type ConversationMode = "talk_to_me" | "teach_me";

export type ConversationTurn = {
  role: "user" | "assistant";
  content: string;
};

/** Maximum persisted turns per session+mode (user + assistant messages count). */
export const MAX_CONVERSATION_TURNS = 10;

function historyKey(sessionId: string, mode: ConversationMode): string {
  return `${sessionId}::${mode}`;
}

/**
 * In-memory, mode-scoped conversation history.
 * No persistence / database — process lifetime only.
 */
export class ConversationStore {
  private readonly histories = new Map<string, ConversationTurn[]>();

  getHistory(sessionId: string, mode: ConversationMode): ConversationTurn[] {
    const turns = this.histories.get(historyKey(sessionId, mode));
    return turns ? turns.map((turn) => ({ ...turn })) : [];
  }

  append(
    sessionId: string,
    mode: ConversationMode,
    turn: ConversationTurn,
  ): void {
    const key = historyKey(sessionId, mode);
    const existing = this.histories.get(key) ?? [];
    const next = [...existing, { role: turn.role, content: turn.content }];
    const bounded =
      next.length > MAX_CONVERSATION_TURNS
        ? next.slice(next.length - MAX_CONVERSATION_TURNS)
        : next;
    this.histories.set(key, bounded);
  }

  clear(sessionId: string, mode: ConversationMode): void {
    this.histories.delete(historyKey(sessionId, mode));
  }
}
