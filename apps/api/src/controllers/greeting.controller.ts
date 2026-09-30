import type { Request, Response } from "express";
import {
  buildGreeting,
  type Clock,
  type GreetingLanguage,
} from "../services/greeting.service.js";
import type { Approval } from "@crystal-ball/shared";
import { asyncHandler } from "./asyncHandler.js";

export function createGreetingController(deps: {
  clock: Clock;
  approvals: readonly Approval[];
}) {
  return asyncHandler(async (req: Request, res: Response) => {
    const language = (req.query.language as GreetingLanguage | undefined) ?? "en";
    const result = buildGreeting(deps.approvals, {
      clock: deps.clock,
      language,
    });

    res.status(200).json({
      greeting: result.message,
      meta: {
        dayPart: result.dayPart,
        totalCount: result.totalCount,
        urgency: result.urgency,
        highestPriorityApprovalId: result.highestPriorityApprovalId,
        highestPriorityTitle: result.highestPriorityTitle,
        language,
      },
    });
  });
}
