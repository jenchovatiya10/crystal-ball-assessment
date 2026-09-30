import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export const REQUEST_ID_HEADER = "x-request-id";

declare module "express-serve-static-core" {
  interface Request {
    requestId: string;
    sessionId?: string;
  }
}

/**
 * Assigns a request ID (incoming header or generated UUID) and echoes it.
 */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.header(REQUEST_ID_HEADER)?.trim();
  const requestId =
    incoming && incoming.length > 0 && incoming.length <= 128
      ? incoming
      : randomUUID();

  req.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}
