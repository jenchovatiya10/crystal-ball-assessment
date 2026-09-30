import cors from "cors";
import express, { type Express, type Request, type Response } from "express";
import helmet from "helmet";
import type { AppDeps } from "./deps.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { createAiRateLimiter } from "./middleware/rateLimit.js";
import { requestIdMiddleware } from "./middleware/requestId.js";
import { requireSessionId } from "./middleware/sessionId.js";
import { createAssistantRouter } from "./routes/assistant.routes.js";

export type { AppDeps } from "./deps.js";

export type AppConfig = {
  webOrigin: string | string[];
  jsonLimit?: string;
  rateLimitWindowMs?: number;
  rateLimitMax?: number;
};

/**
 * Express application factory with injectable deps for Supertest / FakeAIProvider.
 */
export function createApp(deps: AppDeps, config: AppConfig): Express {
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

  app.use(
    "/api",
    createAssistantRouter(deps, {
      rateLimitWindowMs: config.rateLimitWindowMs,
      rateLimitMax: config.rateLimitMax,
    }),
  );

  // Internal probe retained for middleware unit coverage.
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
