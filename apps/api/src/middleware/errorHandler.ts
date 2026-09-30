import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { HttpError } from "./sessionId.js";

export type ErrorBody = {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
};

function requestIdOf(req: Request): string {
  return req.requestId ?? "unknown";
}

function isPayloadTooLarge(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "type" in err &&
    (err as { type?: string }).type === "entity.too.large"
  );
}

/**
 * Generic error envelope — never leak stacks, SDK errors, or secrets.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = requestIdOf(req);

  if (err instanceof HttpError) {
    const body: ErrorBody = {
      error: {
        code: err.code,
        message: err.message,
        requestId,
      },
    };
    res.status(err.statusCode).json(body);
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "BAD_REQUEST",
        message: "Request validation failed",
        requestId,
      },
    });
    return;
  }

  if (isPayloadTooLarge(err)) {
    res.status(413).json({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "Request body exceeds the allowed size",
        requestId,
      },
    });
    return;
  }

  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
      requestId,
    },
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "Resource not found",
      requestId: requestIdOf(req),
    },
  });
}
