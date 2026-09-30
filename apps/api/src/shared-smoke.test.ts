import { parseHealthPayload } from "./shared-smoke.js";

describe("shared workspace import", () => {
  it("parses health payload via @crystal-ball/shared", () => {
    expect(parseHealthPayload({ status: "ok" })).toEqual({ status: "ok" });
  });
});
