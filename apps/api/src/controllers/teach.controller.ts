import type { Request, Response } from "express";
import type { ConversationService } from "../services/conversation.service.js";
import { asyncHandler } from "./asyncHandler.js";

function initSse(res: Response): void {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
}

function sendSse(res: Response, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function createTeachController(conversationService: ConversationService) {
  return asyncHandler(async (req: Request, res: Response) => {
    const sessionId = String(req.body.sessionId);
    const message = String(req.body.message);
    const controller = new AbortController();
    req.on("close", () => controller.abort());

    initSse(res);
    try {
      for await (const chunk of conversationService.streamTurn({
        sessionId,
        mode: "teach_me",
        message,
        signal: controller.signal,
      })) {
        sendSse(res, { type: "token", text: chunk });
      }
      sendSse(res, { type: "done" });
      res.end();
    } catch (error) {
      if (!res.headersSent) {
        throw error;
      }
      sendSse(res, {
        type: "error",
        message: "Stream interrupted",
      });
      res.end();
    }
  });
}
