import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

export const SESSION_ID_HEADER = "x-session-id";

const SessionIdSchema = z.string().uuid();

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * Requires a valid UUID in X-Session-Id (for AI / session-scoped routes).
 */
export function requireSessionId(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const raw = req.header(SESSION_ID_HEADER)?.trim();
  const parsed = SessionIdSchema.safeParse(raw);
  if (!parsed.success) {
    next(
      new HttpError(
        400,
        "INVALID_SESSION_ID",
        "X-Session-Id must be a valid UUID",
      ),
    );
    return;
  }
  req.sessionId = parsed.data;
  next();
}
