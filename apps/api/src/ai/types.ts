import type { z } from "zod";

/**
 * Provider-level chat message. Domain-agnostic — no summary/help concepts.
 */
export type AIMessageRole = "system" | "user" | "assistant";

export type AIMessage = {
  role: AIMessageRole;
  content: string;
};

export type GenerateStructuredParams<T> = {
  /** Versioned / assembled prompt text for the model. */
  prompt: string;
  /** Arbitrary structured input payload for the prompt. */
  input: unknown;
  /** Zod schema the provider must satisfy for the response. */
  schema: z.ZodType<T>;
  signal?: AbortSignal;
};

export type StreamParams = {
  prompt: string;
  messages: readonly AIMessage[];
  signal?: AbortSignal;
};
