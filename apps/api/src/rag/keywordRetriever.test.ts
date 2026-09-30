import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chunkPolicyMarkdown, loadPolicyChunks } from "./chunker.js";
import {
  KEYWORD_MIN_SCORE,
  KEYWORD_TOP_K,
  KeywordRetriever,
} from "./keywordRetriever.js";
import type { Chunk } from "./Retriever.js";

const policyPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../policy/policy.md",
);

describe("policy chunker", () => {
  it("produces between 3 and 5 chunks from policy.md", () => {
    const markdown = readFileSync(policyPath, "utf8");
    const chunks = chunkPolicyMarkdown(markdown);

    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks.length).toBeLessThanOrEqual(5);
  });

  it("assigns unique policy-XX chunk IDs", async () => {
    const chunks = await loadPolicyChunks(policyPath);
    const ids = chunks.map((c) => c.id);

    expect(ids).toEqual(
      chunks.map((_, i) => `policy-${String(i + 1).padStart(2, "0")}`),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers folder, video, pdf, and image fixture types", () => {
    const markdown = readFileSync(policyPath, "utf8").toLowerCase();

    expect(markdown).toContain("folder");
    expect(markdown).toContain("video");
    expect(markdown).toContain("pdf");
    expect(markdown).toContain("image");
  });
});

describe("KeywordRetriever", () => {
  const chunks: Chunk[] = [
    {
      id: "policy-01",
      title: "Review Order",
      text: "Always review overdue safety items before lower urgency demos.",
    },
    {
      id: "policy-02",
      title: "Item Type Rules",
      text: "Folders checklists videos pdfs and images each have specific review steps.",
    },
    {
      id: "policy-03",
      title: "Escalation Path",
      text: "Escalate blocked approvals to the duty supervisor within one business day.",
    },
  ];

  it("finds a relevant chunk for a topical query", async () => {
    const retriever = new KeywordRetriever(chunks);
    const results = await retriever.retrieve("how do I escalate blocked approvals?", 2);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.id).toBe("policy-03");
    expect(results[0]!.score).toBeGreaterThan(0);
  });

  it("weights title matches higher than body-only matches", async () => {
    const retriever = new KeywordRetriever([
      {
        id: "policy-01",
        title: "General Notes",
        text: "Escalation is mentioned only in the body text here.",
      },
      {
        id: "policy-02",
        title: "Escalation Guidance",
        text: "Contact the supervisor when needed.",
      },
    ]);

    const results = await retriever.retrieve("escalation", 2);

    expect(results[0]?.id).toBe("policy-02");
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
  });

  it("respects top-K limiting", async () => {
    const retriever = new KeywordRetriever(chunks);
    const results = await retriever.retrieve("review safety folders videos", KEYWORD_TOP_K);

    expect(KEYWORD_TOP_K).toBe(2);
    expect(results.length).toBeLessThanOrEqual(KEYWORD_TOP_K);
  });

  it("returns empty results for an irrelevant query", async () => {
    const retriever = new KeywordRetriever(chunks);
    const results = await retriever.retrieve(
      "quantum blockchain culinary recipes",
      KEYWORD_TOP_K,
    );

    expect(results).toEqual([]);
  });

  it("applies the no-answer minimum score threshold", async () => {
    const retriever = new KeywordRetriever(chunks);
    const weak = await retriever.retrieve("zzz", KEYWORD_TOP_K);

    expect(KEYWORD_MIN_SCORE).toBeGreaterThan(0);
    expect(weak.every((r) => r.score >= KEYWORD_MIN_SCORE)).toBe(true);
    expect(weak).toEqual([]);
  });

  it("loads real policy chunks and retrieves type-rule content", async () => {
    const policyChunks = await loadPolicyChunks(policyPath);
    const retriever = new KeywordRetriever(policyChunks);
    const results = await retriever.retrieve(
      "pdf image video folder review rules",
      KEYWORD_TOP_K,
    );

    expect(policyChunks.length).toBeGreaterThanOrEqual(3);
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(KEYWORD_TOP_K);
  });
});
