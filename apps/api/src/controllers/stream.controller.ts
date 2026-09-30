import type { Request, Response } from "express";
import { initAssistantSse, writeSseEvent } from "../http/sse.js";
import { HttpError } from "../middleware/sessionId.js";
import type { ConversationService } from "../services/conversation.service.js";
import type { ConversationMode } from "../services/conversationStore.js";
import { asyncHandler } from "./asyncHandler.js";

export function createAssistantStreamController(
  conversationService: ConversationService,
  mode: ConversationMode,
) {
  return asyncHandler(async (req: Request, res: Response) => {
    const headerSessionId = req.sessionId;
    const bodySessionId = String(req.body.sessionId ?? "");
    if (!headerSessionId || bodySessionId !== headerSessionId) {
      throw new HttpError(
        400,
        "SESSION_MISMATCH",
        "sessionId must match X-Session-Id",
      );
    }

    const sessionId = headerSessionId;
    const message = String(req.body.message);
    const requestId = req.requestId;
    const controller = new AbortController();

    const onClose = () => {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    };
    req.on("close", onClose);

    initAssistantSse(res);
    writeSseEvent(res, "meta", { sessionId, requestId });

    try {
      for await (const event of conversationService.runAssistantStream({
        sessionId,
        mode,
        message,
        signal: controller.signal,
      })) {
        if (event.type === "token") {
          writeSseEvent(res, "token", { t: event.t });
        } else if (event.type === "done") {
          writeSseEvent(
            res,
            "done",
            event.fallback ? { fallback: true } : {},
          );
        } else if (event.type === "error") {
          writeSseEvent(res, "error", {
            code: event.code,
            message: event.message,
            fallback: true,
          });
        }
      }
      res.end();
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        if (!res.writableEnded) {
          res.end();
        }
        return;
      }
      if (!res.headersSent) {
        throw error;
      }
      writeSseEvent(res, "error", {
        code: "STREAM_ERROR",
        message: "Stream interrupted",
        fallback: true,
      });
      res.end();
    } finally {
      req.off("close", onClose);
    }
  });
}
