import { z } from "zod";

export {
  ApprovalTypeSchema,
  PrioritySchema,
  ApprovalSchema,
  PriorityItemSchema,
  SummaryResponseSchema,
  HelpResponseSchema,
  SummaryRequestSchema,
  ChatRequestSchema,
  TeachRequestSchema,
  HelpRequestSchema,
  ErrorResponseSchema,
} from "./schemas.js";

export type {
  ApprovalType,
  Priority,
  Approval,
  PriorityItem,
  SummaryResponse,
  HelpResponse,
  SummaryRequest,
  ChatRequest,
  TeachRequest,
  HelpRequest,
  ErrorResponse,
} from "./schemas.js";

/**
 * Foundation wiring schemas retained for workspace smoke checks.
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
