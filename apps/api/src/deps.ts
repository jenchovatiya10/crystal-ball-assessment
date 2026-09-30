import type { Approval } from "@crystal-ball/shared";
import type { AIProvider } from "./ai/AIProvider.js";
import type { Clock } from "./services/greeting.service.js";

export type AppDeps = {
  provider: AIProvider;
  clock: Clock;
  approvals: readonly Approval[];
};
