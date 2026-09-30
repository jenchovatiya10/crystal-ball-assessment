/**
 * RAG chunk and retriever contracts — domain-agnostic over policy text.
 */

export type Chunk = {
  id: string;
  title: string;
  text: string;
};

export type ScoredChunk = Chunk & {
  score: number;
};

export interface Retriever {
  retrieve(query: string, k: number): Promise<ScoredChunk[]>;
}
