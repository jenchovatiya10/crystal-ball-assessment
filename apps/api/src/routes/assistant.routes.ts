import {
  ChatRequestSchema,
  GreetingQuerySchema,
  HelpRequestSchema,
  SummaryRequestSchema,
  TeachRequestSchema,
} from "@crystal-ball/shared";
import { Router, type Request, type Response } from "express";
import type { AppDeps } from "../deps.js";
import { createChatController } from "../controllers/chat.controller.js";
import { createGreetingController } from "../controllers/greeting.controller.js";
import { createHelpController } from "../controllers/help.controller.js";
import { createSummaryController } from "../controllers/summary.controller.js";
import { createTeachController } from "../controllers/teach.controller.js";
import { createAiRateLimiter } from "../middleware/rateLimit.js";
import { requireSessionId } from "../middleware/sessionId.js";
import { validate } from "../middleware/validate.js";
import { loadPolicyChunks } from "../rag/chunker.js";
import { KeywordRetriever } from "../rag/keywordRetriever.js";
import { ConversationService } from "../services/conversation.service.js";
import { ConversationStore } from "../services/conversationStore.js";
import { HelpService } from "../services/help.service.js";
import { SummaryService } from "../services/summary.service.js";

export type AssistantRouteOptions = {
  rateLimitWindowMs?: number;
  rateLimitMax?: number;
};

export function createAssistantRouter(
  deps: AppDeps,
  options: AssistantRouteOptions = {},
): Router {
  const router = Router();

  const summaryService = new SummaryService(deps.provider, {
    getNow: () => deps.clock.now(),
    approvals: deps.approvals,
  });
  const helpService = new HelpService(
    deps.provider,
    new KeywordRetriever(loadPolicyChunks()),
  );
  const conversationStore = new ConversationStore();
  const conversationService = new ConversationService(
    deps.provider,
    conversationStore,
    { approvals: deps.approvals },
  );

  const aiRateLimit = createAiRateLimiter({
    windowMs: options.rateLimitWindowMs ?? 60_000,
    max: options.rateLimitMax ?? 30,
  });

  router.get("/approvals", (_req: Request, res: Response) => {
    res.status(200).json({ approvals: deps.approvals });
  });

  router.post(
    "/assistant/summary",
    requireSessionId,
    aiRateLimit,
    validate(SummaryRequestSchema, "body"),
    createSummaryController(summaryService),
  );

  router.post(
    "/assistant/help",
    requireSessionId,
    aiRateLimit,
    validate(HelpRequestSchema, "body"),
    createHelpController(helpService),
  );

  router.post(
    "/assistant/chat",
    requireSessionId,
    aiRateLimit,
    validate(ChatRequestSchema, "body"),
    createChatController(conversationService),
  );

  router.post(
    "/assistant/teach",
    requireSessionId,
    aiRateLimit,
    validate(TeachRequestSchema, "body"),
    createTeachController(conversationService),
  );

  router.get(
    "/assistant/greeting",
    requireSessionId,
    aiRateLimit,
    validate(GreetingQuerySchema, "query"),
    createGreetingController({
      clock: deps.clock,
      approvals: deps.approvals,
    }),
  );

  return router;
}
