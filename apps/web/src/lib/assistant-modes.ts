import type { Approval } from "@crystal-ball/shared";

export type AssistantMode =
  | "summary"
  | "talk"
  | "help"
  | "teach"
  | "greeting";

export type ApprovalsResponse = {
  approvals: Approval[];
};

export const ASSISTANT_MODES: ReadonlyArray<{
  id: AssistantMode;
  label: string;
  description: string;
}> = [
  {
    id: "summary",
    label: "Present me Summary",
    description: "Ranked overview of waiting approvals",
  },
  {
    id: "talk",
    label: "Talk to me",
    description: "Conversational guidance on the queue",
  },
  {
    id: "help",
    label: "Help me",
    description: "Policy-grounded answers",
  },
  {
    id: "teach",
    label: "Teach me",
    description: "Step-by-step review coaching",
  },
  {
    id: "greeting",
    label: "Replay Greeting",
    description: "Deterministic live greeting",
  },
] as const;
