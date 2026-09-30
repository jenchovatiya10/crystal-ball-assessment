import { z } from "zod";

export {
  ApprovalTypeSchema,
  PrioritySchema,
  ApprovalSchema,
  PriorityItemSchema,
  SummaryResponseSchema,
  HelpResponseSchema,
  LanguageSchema,
  SummaryRequestSchema,
  ChatRequestSchema,
  TeachRequestSchema,
  HelpRequestSchema,
  GreetingQuerySchema,
  ErrorResponseSchema,
} from "./schemas.js";

export type {
  ApprovalType,
  Priority,
  Approval,
  PriorityItem,
  SummaryResponse,
  HelpResponse,
  Language,
  SummaryRequest,
  ChatRequest,
  TeachRequest,
  HelpRequest,
  GreetingQuery,
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
