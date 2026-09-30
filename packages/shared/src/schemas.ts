import { z } from "zod";

/** Supported approval content types. */
export const ApprovalTypeSchema = z.enum(["folder", "video", "pdf", "image"]);

export type ApprovalType = z.infer<typeof ApprovalTypeSchema>;

/** Deterministic ranking priority levels. */
export const PrioritySchema = z.enum(["critical", "high", "medium", "low"]);

export type Priority = z.infer<typeof PrioritySchema>;

const IsoDateTimeSchema = z
  .string()
  .datetime({ offset: true, message: "Must be an ISO-8601 datetime string" });

const NonEmptyIdSchema = z.string().trim().min(1).max(64);
const ShortTextSchema = z.string().trim().min(1).max(200);
const MediumTextSchema = z.string().trim().min(1).max(500);
const LongTextSchema = z.string().trim().min(1).max(2000);
const AnswerTextSchema = z.string().trim().min(1).max(4000);
const FlagSchema = z.string().trim().min(1).max(64);

export const ApprovalSchema = z.object({
  id: NonEmptyIdSchema,
  title: ShortTextSchema,
  type: ApprovalTypeSchema,
  submittedAt: IsoDateTimeSchema,
  dueAt: IsoDateTimeSchema,
  flags: z.array(FlagSchema).max(20),
});

export type Approval = z.infer<typeof ApprovalSchema>;

export const PriorityItemSchema = z.object({
  approvalId: NonEmptyIdSchema,
  priority: PrioritySchema,
  reason: MediumTextSchema,
});

export type PriorityItem = z.infer<typeof PriorityItemSchema>;

export const SummaryResponseSchema = z.object({
  overview: LongTextSchema,
  priorityItems: z.array(PriorityItemSchema).max(50),
  recommendedNextAction: MediumTextSchema,
});

export type SummaryResponse = z.infer<typeof SummaryResponseSchema>;

export const HelpResponseSchema = z.object({
  answer: AnswerTextSchema,
  sources: z.array(ShortTextSchema).max(20),
  grounded: z.boolean(),
});

export type HelpResponse = z.infer<typeof HelpResponseSchema>;

export const LanguageSchema = z.enum(["en", "es"]);

export type Language = z.infer<typeof LanguageSchema>;

export const SummaryRequestSchema = z
  .object({
    language: LanguageSchema.optional(),
  })
  .strict();

export type SummaryRequest = z.infer<typeof SummaryRequestSchema>;

export const ChatRequestSchema = z
  .object({
    sessionId: z.string().uuid(),
    message: AnswerTextSchema,
    language: LanguageSchema.optional(),
  })
  .strict();

export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const TeachRequestSchema = z
  .object({
    sessionId: z.string().uuid(),
    message: AnswerTextSchema,
    language: LanguageSchema.optional(),
  })
  .strict();

export type TeachRequest = z.infer<typeof TeachRequestSchema>;

export const HelpRequestSchema = z
  .object({
    question: LongTextSchema,
    language: LanguageSchema.optional(),
  })
  .strict();

export type HelpRequest = z.infer<typeof HelpRequestSchema>;

export const GreetingQuerySchema = z
  .object({
    language: LanguageSchema.optional(),
  })
  .strict();

export type GreetingQuery = z.infer<typeof GreetingQuerySchema>;

export const ErrorResponseSchema = z.object({
  code: z.string().trim().min(1).max(64),
  message: MediumTextSchema,
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
