import { z } from "zod";

/**
 * Minimal shared schemas for workspace wiring.
 * Feature schemas (modes, SSE events, etc.) will be added later.
 */

export const HealthStatusSchema = z.object({
  status: z.literal("ok"),
});

export type HealthStatus = z.infer<typeof HealthStatusSchema>;

export const ModeNameSchema = z.enum([
  "present_me_summary",
  "talk_to_me",
  "help_me",
  "teach_me",
  "replay_greeting",
]);

export type ModeName = z.infer<typeof ModeNameSchema>;
