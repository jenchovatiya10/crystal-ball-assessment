# AI vs deterministic decisions

This document records **where** Crystal Ball uses an LLM and **where** it must stay deterministic, with short reasoning for each mode.

## Summary → AI

**Present me Summary** calls the LLM for overview prose, per-item reasons, and a recommended next action.

**Why AI:** Narrative explanation is generative. Ranking itself is **not** delegated to the model.

**Guardrails:** `RankingService` computes order and priorities first. The prompt forbids inventing or reordering. `validateSummarySemantics` ensures `priorityItems` match ranked IDs/order/priorities. Invalid/timeout/unavailable paths return `buildSummaryFallback` with `meta.source: "fallback"`.

## Talk → AI

**Talk to me** streams a conversational reply over SSE using queue context + bounded history.

**Why AI:** Open-ended dialogue needs a language model. Context is compact fixture data, treated as data not instructions.

**Guardrails:** Versioned `chat.v1` prompt; 8s timeout; one pre-token transient retry only; mid-stream failure → sanitized `error` event (no retry); history capped (`MAX_CONVERSATION_TURNS`).

## Help retrieval → deterministic

Chunk loading and **KeywordRetriever** scoring are pure code (title/body keywords, `topK`, min score). No embeddings, no LLM for retrieval.

**Why deterministic:** Retrieval must be predictable, cheap, and testable. Hallucinated “sources” must not appear from search itself.

**No-answer:** If nothing clears the score threshold, Help returns a grounded=false / empty-sources fallback and **does not call** the provider.

## Help answer → AI

When chunks exist, the LLM answers only from those chunks and cites chunk IDs.

**Why AI:** Natural-language Q&A over policy text.

**Guardrails:** Prompt envelopes escape user/policy markup (`escapePromptData`). Zod `HelpResponseSchema`. `validateHelpSemantics` requires every cited source ∈ retrieved IDs (and empty sources when `grounded=false`). Fabricated IDs → fallback from retrieved excerpts only.

## Teach → AI

**Teach me** streams coaching steps (open → verify type → check policy → decide → record) over the same SSE pipeline as Talk, with `teach.v1` prompt constraints.

**Why AI:** Pedagogical phrasing varies; the workflow skeleton is fixed in the prompt.

**Guardrails:** Same streaming resilience as Talk; must not invent policy beyond supplied context.

## Greeting → deterministic

**Replay Greeting** is assembled by `buildGreeting` from approvals + injectable clock (+ optional language). **No LLM.**

**Why deterministic:** Greeting is a live pulse over known fixture state (day part, counts, urgency, top title). Non-determinism would break tests and trust.

## Cross-cutting

| Concern | Owner |
|---------|--------|
| Ranking order / priorities | `RankingService` only |
| Provider I/O | `AIProvider` (+ `ResilientAIProvider`) |
| Schema | `@crystal-ball/shared` Zod |
| Secrets | Server env only |
