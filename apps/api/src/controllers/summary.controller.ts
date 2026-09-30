import type { Request, Response } from "express";
import type { SummaryService } from "../services/summary.service.js";
import { asyncHandler } from "./asyncHandler.js";

export function createSummaryController(summaryService: SummaryService) {
  return asyncHandler(async (_req: Request, res: Response) => {
    const result = await summaryService.presentSummary();
    res.status(200).json({
      data: result.data,
      meta: result.meta,
    });
  });
}
