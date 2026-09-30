import { ModeNameSchema } from "@crystal-ball/shared";
import { describe, expect, it } from "vitest";

describe("shared workspace import", () => {
  it("exposes ModeNameSchema from @crystal-ball/shared", () => {
    expect(ModeNameSchema.parse("talk_to_me")).toBe("talk_to_me");
  });
});
