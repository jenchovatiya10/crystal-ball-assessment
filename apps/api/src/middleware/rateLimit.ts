import type { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { SESSION_ID_HEADER } from "./sessionId.js";

export type AiRateLimitOptions = {
  windowMs?: number;
  max?: number;
};

/**
 * In-memory AI rate limiter keyed by X-Session-Id (falls back to IP).
 * No Redis.
 */
export function createAiRateLimiter(options: AiRateLimitOptions = {}) {
  const windowMs = options.windowMs ?? 60_000;
  const max = options.max ?? 30;

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    validate: {
      xForwardedForHeader: false,
      keyGeneratorIpFallback: false,
    },
    keyGenerator: (req: Request) => {
      const sessionId = req.header(SESSION_ID_HEADER)?.trim();
      if (sessionId && sessionId.length > 0) {
        return `session:${sessionId}`;
      }
      // Session middleware should run first on AI routes; IP is a safe fallback.
      return `ip:${req.ip ?? "unknown"}`;
    },
    handler: (req: Request, res: Response, _next: NextFunction, optionsUsed) => {
      const retryAfterSeconds = Math.ceil(optionsUsed.windowMs / 1000);
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests. Please try again later.",
          requestId: req.requestId ?? "unknown",
        },
      });
    },
  });
}
