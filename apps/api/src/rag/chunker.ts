import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Chunk } from "./Retriever.js";

const DEFAULT_POLICY_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../policy/policy.md",
);

/**
 * Split policy markdown into titled sections → Chunk[].
 * Expects `## Heading` sections (3–5 for the assessment policy).
 */
export function chunkPolicyMarkdown(markdown: string): Chunk[] {
  const normalized = markdown.replace(/\r\n/g, "\n").trim();
  const parts = normalized.split(/^##\s+/m).slice(1);

  const sections = parts
    .map((part) => {
      const newline = part.indexOf("\n");
      const title = (newline === -1 ? part : part.slice(0, newline)).trim();
      const body = (newline === -1 ? "" : part.slice(newline + 1))
        .trim()
        .replace(/\s+/g, " ");
      return { title, text: body };
    })
    .filter((section) => section.title.length > 0 && section.text.length > 0);

  if (sections.length < 3 || sections.length > 5) {
    throw new Error(
      `policy.md must contain 3–5 ## sections (found ${sections.length})`,
    );
  }

  return sections.map((section, index) => ({
    id: `policy-${String(index + 1).padStart(2, "0")}`,
    title: section.title,
    text: section.text,
  }));
}

export function loadPolicyChunks(policyPath: string = DEFAULT_POLICY_PATH): Chunk[] {
  const markdown = readFileSync(policyPath, "utf8");
  return chunkPolicyMarkdown(markdown);
}
