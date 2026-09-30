import { describe, expect, it } from "vitest";
import { SseParser, parseSseFrame } from "@/lib/sseParser";

describe("parseSseFrame", () => {
  it("parses one complete event", () => {
    const parsed = parseSseFrame(
      'event: meta\ndata: {"sessionId":"abc","requestId":"req-1"}',
    );
    expect(parsed).toEqual({
      event: "meta",
      data: { sessionId: "abc", requestId: "req-1" },
      rawData: '{"sessionId":"abc","requestId":"req-1"}',
    });
  });
});

describe("SseParser", () => {
  it("parses multiple events from a single chunk", () => {
    const parser = new SseParser();
    const events = parser.push(
      [
        'event: meta\ndata: {"sessionId":"s1","requestId":"r1"}\n\n',
        'event: token\ndata: {"t":"Hel"}\n\n',
        'event: token\ndata: {"t":"lo"}\n\n',
        "event: done\ndata: {}\n\n",
      ].join(""),
    );

    expect(events.map((e) => e.event)).toEqual([
      "meta",
      "token",
      "token",
      "done",
    ]);
    expect(events[1]?.data).toEqual({ t: "Hel" });
    expect(events[3]?.data).toEqual({});
  });

  it("assembles a split event across chunks", () => {
    const parser = new SseParser();

    expect(parser.push("event: tok")).toEqual([]);
    expect(parser.getPending()).toContain("event: tok");

    expect(parser.push("en\ndata: {\"t\":\"A\"}")).toEqual([]);
    const completed = parser.push("\n\n");

    expect(completed).toEqual([
      {
        event: "token",
        data: { t: "A" },
        rawData: '{"t":"A"}',
      },
    ]);
    expect(parser.getPending()).toBe("");
  });

  it("parses token events", () => {
    const parser = new SseParser();
    const events = parser.push('event: token\ndata: {"t":"partial"}\n\n');
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe("token");
    expect(events[0]?.data).toEqual({ t: "partial" });
  });

  it("parses done events including fallback metadata", () => {
    const parser = new SseParser();
    const plain = parser.push("event: done\ndata: {}\n\n");
    const fallback = parser.push(
      'event: done\ndata: {"fallback":true}\n\n',
    );

    expect(plain[0]).toMatchObject({ event: "done", data: {} });
    expect(fallback[0]).toMatchObject({
      event: "done",
      data: { fallback: true },
    });
  });

  it("parses error events", () => {
    const parser = new SseParser();
    const events = parser.push(
      'event: error\ndata: {"code":"AI_UNAVAILABLE","message":"mid","fallback":true}\n\n',
    );

    expect(events).toEqual([
      {
        event: "error",
        data: {
          code: "AI_UNAVAILABLE",
          message: "mid",
          fallback: true,
        },
        rawData:
          '{"code":"AI_UNAVAILABLE","message":"mid","fallback":true}',
      },
    ]);
  });

  it("keeps an incomplete trailing frame buffered", () => {
    const parser = new SseParser();
    const events = parser.push(
      'event: token\ndata: {"t":"ok"}\n\nevent: done\ndata: {',
    );

    expect(events.map((e) => e.event)).toEqual(["token"]);
    expect(parser.getPending()).toBe("event: done\ndata: {");
  });
});
