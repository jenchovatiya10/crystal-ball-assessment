import assert from "node:assert/strict";
import { test } from "node:test";
import { HealthStatusSchema, ModeNameSchema } from "./index.js";

test("HealthStatusSchema accepts ok", () => {
  const parsed = HealthStatusSchema.parse({ status: "ok" });
  assert.equal(parsed.status, "ok");
});

test("ModeNameSchema rejects unknown mode", () => {
  assert.throws(() => ModeNameSchema.parse("unknown"));
});
