import type { NextFunction, Request, Response } from "express";
import { ZodError, type ZodType } from "zod";

export type ValidateTarget = "body" | "query" | "params";

/**
 * Zod validation middleware. On failure → 400 with generic error envelope.
 */
export function validate<T>(schema: ZodType<T>, target: ValidateTarget = "body") {
  return (req: Request, res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req[target]);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: "BAD_REQUEST",
          message: "Request validation failed",
          requestId: req.requestId ?? "unknown",
        },
      });
      return;
    }

    // Express typing for query/params is wide; assign validated value.
    (req as Request & Record<ValidateTarget, T>)[target] = parsed.data;
    next();
  };
}

export function formatZodMessage(error: ZodError): string {
  return error.issues.map((issue) => issue.message).join("; ");
}
