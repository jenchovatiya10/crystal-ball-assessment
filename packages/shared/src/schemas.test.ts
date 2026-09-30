import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ApprovalSchema,
  PrioritySchema,
  SummaryResponseSchema,
} from "./schemas.js";

const validApproval = {
  id: "apr_folder_site_patrol_onboarding",
  title: "Site Patrol Onboarding & Checklists Folder",
  type: "folder",
  submittedAt: "2026-09-20T09:00:00.000Z",
  dueAt: "2026-10-02T17:00:00.000Z",
  flags: ["checklist", "onboarding"],
} as const;

const validSummary = {
  overview: "Four approvals need attention before the patrol window closes.",
  priorityItems: [
    {
      approvalId: "apr_folder_site_patrol_onboarding",
      priority: "high",
      reason: "Onboarding checklist is due soon and blocks field access.",
    },
  ],
  recommendedNextAction:
    "Review the Site Patrol Onboarding & Checklists Folder first.",
} as const;

test("valid approval passes", () => {
  const parsed = ApprovalSchema.parse(validApproval);
  assert.equal(parsed.id, validApproval.id);
  assert.equal(parsed.type, "folder");
});

test("invalid approval fails", () => {
  assert.throws(() =>
    ApprovalSchema.parse({
      ...validApproval,
      type: "spreadsheet",
    }),
  );
  assert.throws(() =>
    ApprovalSchema.parse({
      ...validApproval,
      id: "",
    }),
  );
  assert.throws(() =>
    ApprovalSchema.parse({
      id: validApproval.id,
      title: validApproval.title,
      type: validApproval.type,
      submittedAt: validApproval.submittedAt,
      dueAt: validApproval.dueAt,
      // flags missing
    }),
  );
});

test("valid summary passes", () => {
  const parsed = SummaryResponseSchema.parse(validSummary);
  assert.equal(parsed.priorityItems.length, 1);
  assert.equal(parsed.priorityItems[0]?.priority, "high");
});

test("invalid summary fails", () => {
  assert.throws(() =>
    SummaryResponseSchema.parse({
      overview: validSummary.overview,
      priorityItems: [
        {
          approvalId: "apr_folder_site_patrol_onboarding",
          priority: "urgent",
          reason: "bad priority",
        },
      ],
      recommendedNextAction: validSummary.recommendedNextAction,
    }),
  );
  assert.throws(() =>
    SummaryResponseSchema.parse({
      overview: "",
      priorityItems: [],
      recommendedNextAction: validSummary.recommendedNextAction,
    }),
  );
});

test("invalid priority fails", () => {
  assert.throws(() => PrioritySchema.parse("urgent"));
  assert.throws(() => PrioritySchema.parse(""));
  assert.throws(() => PrioritySchema.parse(1));
});
