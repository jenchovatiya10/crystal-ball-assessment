import cors from "cors";
import express, { type Express, type Request, type Response } from "express";
import helmet from "helmet";
import type { Approval } from "@crystal-ball/shared";
import type { AIProvider } from "./ai/AIProvider.js";
import type { Clock } from "./services/greeting.service.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { createAiRateLimiter } from "./middleware/rateLimit.js";
import { requestIdMiddleware } from "./middleware/requestId.js";
import { requireSessionId } from "./middleware/sessionId.js";

export type AppDeps = {
  provider: AIProvider;
  clock: Clock;
  approvals: readonly Approval[];
};

export type AppConfig = {
  webOrigin: string | string[];
  jsonLimit?: string;
  rateLimitWindowMs?: number;
  rateLimitMax?: number;
};

/**
 * Express application factory with injectable deps for Supertest / FakeAIProvider.
 * Assistant feature routes are intentionally not mounted yet.
 */
export function createApp(deps: AppDeps, config: AppConfig): Express {
  // Deps are captured for upcoming assistant routes / test injection.
  void deps;

  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin: config.webOrigin,
      credentials: true,
    }),
  );
  app.use(requestIdMiddleware);
  app.use(express.json({ limit: config.jsonLimit ?? "10kb" }));

  app.get("/api/health", (_req: Request, res: Response) => {
    res.status(200).json({ ok: true });
  });

  // Internal probe for session + rate-limit middleware (not a product feature).
  const aiRateLimit = createAiRateLimiter({
    windowMs: config.rateLimitWindowMs ?? 60_000,
    max: config.rateLimitMax ?? 30,
  });

  app.get(
    "/api/__middleware_probe__",
    requireSessionId,
    aiRateLimit,
    (req, res) => {
      res.status(200).json({
        ok: true,
        sessionId: req.sessionId,
        requestId: req.requestId,
      });
    },
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
