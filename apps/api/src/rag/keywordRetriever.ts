import type { Chunk, Retriever, ScoredChunk } from "./Retriever.js";

/** Architecture default for Help Me retrieval. */
export const KEYWORD_TOP_K = 2;

/** Minimum score required to return a chunk; below this → no sources / ungrounded. */
export const KEYWORD_MIN_SCORE = 1;

const TITLE_WEIGHT = 3;
const BODY_WEIGHT = 1;

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "if",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "with",
  "by",
  "from",
  "that",
  "this",
  "these",
  "those",
  "it",
  "its",
  "into",
  "about",
  "how",
  "do",
  "i",
  "you",
  "we",
  "they",
  "my",
  "your",
  "our",
]);

/** Lowercase, strip punctuation, drop stopwords, light stem. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
    .map(lightStem);
}

function lightStem(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith("ing") && token.length > 5) return token.slice(0, -3);
  if (token.endsWith("ed") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("es") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("s") && !token.endsWith("ss") && token.length > 3) {
    return token.slice(0, -1);
  }
  return token;
}

function scoreChunk(queryTokens: string[], chunk: Chunk): number {
  if (queryTokens.length === 0) return 0;

  const titleTokens = new Set(tokenize(chunk.title));
  const bodyTokens = new Set(tokenize(`${chunk.title} ${chunk.text}`));

  let score = 0;
  for (const term of queryTokens) {
    if (titleTokens.has(term)) {
      score += TITLE_WEIGHT;
    } else if (bodyTokens.has(term)) {
      score += BODY_WEIGHT;
    }
  }
  return score;
}

/**
 * Deterministic keyword RAG retriever — no embeddings, no LLM.
 */
export class KeywordRetriever implements Retriever {
  constructor(private readonly chunks: readonly Chunk[]) {}

  async retrieve(query: string, k: number = KEYWORD_TOP_K): Promise<ScoredChunk[]> {
    const queryTokens = tokenize(query);
    const scored = this.chunks
      .map((chunk) => ({
        ...chunk,
        score: scoreChunk(queryTokens, chunk),
      }))
      .filter((chunk) => chunk.score >= KEYWORD_MIN_SCORE)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.id.localeCompare(b.id);
      });

    return scored.slice(0, Math.max(0, k));
  }
}
