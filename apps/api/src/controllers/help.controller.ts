import type { Request, Response } from "express";
import type { HelpService } from "../services/help.service.js";
import { asyncHandler } from "./asyncHandler.js";

export function createHelpController(helpService: HelpService) {
  return asyncHandler(async (req: Request, res: Response) => {
    const question = String(req.body.question ?? "");
    const result = await helpService.ask(question);
    res.status(200).json({
      data: result.data,
      meta: result.meta,
    });
  });
}
