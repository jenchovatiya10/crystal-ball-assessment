# Crystal Ball Assessment

npm-workspaces monorepo for the **Crystal Ball Wave 2 Senior Fullstack** assessment: an approval command centre with five assistant modes (Present me Summary, Talk to me, Help me, Teach me, Replay Greeting).

## 1. Project overview

- **`apps/web`** — Next.js App Router UI (React, Zustand, Vitest)
- **`apps/api`** — Express API (Anthropic via injectable `AIProvider`, Jest + Supertest)
- **`packages/shared`** — Shared Zod schemas/types
- **`docs/`** — AI decisions and API contract

Deterministic ranking and greeting never call an LLM. Summary / Talk / Help answers / Teach use AI with Zod validation, timeouts, and fallbacks. Help retrieval is keyword RAG. Talk/Teach stream over SSE (POST + `fetch`).

## 2. Setup

```bash
npm install
cp .env.example .env
npm run build -w @crystal-ball/shared
```

Node.js **20+** and npm **10+** required. Build `@crystal-ball/shared` after install so workspace imports resolve to `dist/`.

## 3. Environment variables

| Variable | Where | Required | Notes |
|----------|--------|----------|--------|
| `ANTHROPIC_API_KEY` | API only | Optional locally | Empty → local FakeAI / deterministic fallbacks. **Never** `NEXT_PUBLIC_*`. |
| `ANTHROPIC_MODEL` | API only | Yes (defaulted) | e.g. `claude-sonnet-4-20250514` |
| `WEB_ORIGIN` | API only | Yes | CORS allowlist, e.g. `http://localhost:3000` |
| `API_PORT` | API only | No (default `3001`) | |
| `NEXT_PUBLIC_API_URL` | Web | No (default `http://localhost:3001`) | Browser-safe API base only |

Copy `.env.example` → `.env`. Do not commit secrets.

## 4. Running frontend

```bash
npm run dev -w @crystal-ball/web
# → http://localhost:3000
```

Or with the API: `npm run dev` from the repo root.

## 5. Running backend

```bash
npm run dev -w @crystal-ball/api
# → http://localhost:3001  (anthropic | local-fallback)
```

Health: `GET http://localhost:3001/api/health`

## 6. Running tests

```bash
npm test                 # shared + api + web
npm run test:api         # Jest + Supertest
npm run test:web         # Vitest + RTL
npm run typecheck
```

Tests use `FakeAIProvider` / scripted doubles — **no real Anthropic calls**.

## 7. Architecture

```
Browser (Next.js)
  → apiClient / SSE parser / useConversation / Zustand
  → Express (/api/*)
       → RankingService | GreetingService (deterministic)
       → SummaryService | HelpService | ConversationService
       → AIProvider (AnthropicProvider | FakeAIProvider)
            wrapped by createResilientAIProvider (8s timeout, one transient retry)
```

- Thin controllers; business logic in services
- Only `AnthropicProvider` imports `@anthropic-ai/sdk`
- Shared Zod schemas validate AI output and HTTP bodies
- Session scoping via `X-Session-Id` (UUID); Talk/Teach also require matching `sessionId` in body

See also [docs/ai-decisions.md](docs/ai-decisions.md) and [docs/api-contract.md](docs/api-contract.md).

## 8. AI vs deterministic decisions

| Mode / concern | Approach |
|----------------|----------|
| Ranking | Deterministic |
| Replay Greeting | Deterministic |
| Help retrieval (RAG) | Deterministic keyword search |
| Present me Summary | AI (+ semantic check vs ranking) |
| Talk / Teach | AI streaming |
| Help answer | AI grounded on retrieved chunks |

Full reasoning: [docs/ai-decisions.md](docs/ai-decisions.md).

## 9. Structured output

Summary and Help use Anthropic **forced tool use** with a Zod-derived JSON schema. Responses are parsed with `SummaryResponseSchema` / `HelpResponseSchema`. Semantic checks then enforce ranking order (Summary) or retrieved source IDs (Help). Failures become deterministic fallbacks — never raw model text as success.

## 10. Streaming

Talk (`POST /api/assistant/chat`) and Teach (`POST /api/assistant/teach`) use **SSE over POST**. Clients use `fetch` + `ReadableStreamDefaultReader` (not `EventSource`). Events: `meta` → `token*` → `done` | `error`. Abort on Stop, mode switch, and unmount. Mid-stream failures do **not** retry (avoids duplicate tokens). Pre-first-token transient failures retry once in `ResilientAIProvider`.

## 11. RAG

Policy text is chunked from `apps/api/policy/policy.md`. `KeywordRetriever` scores title/body matches (`topK=2`, minimum score). No retrieval → Help returns a no-answer payload **without** calling the LLM. Cited sources must be a subset of retrieved chunk IDs.

## 12. Timeout / fallback

AI calls use an **8s** timeout. Transient errors retry once before first useful output; timeouts and mid-stream errors do not. Summary/Help return `{ meta.source: "fallback", reason }`. Streams may emit fallback tokens + `done` with `{ fallback: true }`, or a sanitized `error` event. Client-facing messages never include raw SDK/provider text.

## 13. Rate limiting

In-memory limiter (no Redis) on AI assistant routes, keyed by `X-Session-Id` (IP fallback). Default **30 req / 60s**. Exceeded → `429` with `Retry-After` and a generic error envelope.

## 14. Security

- Anthropic key server-only; never in Next client bundle
- Helmet, CORS (`WEB_ORIGIN`), JSON body limit **10kb**
- Zod validation; invalid UUID session rejected
- Generic error envelopes (no stacks)
- Help prompt escaping against injection; fabricated sources rejected
- `.env` gitignored

## 15. Testing

| Layer | Tooling | Focus |
|-------|---------|--------|
| Shared | Node test runner | Zod schemas |
| API | Jest + Supertest | Services, SSE order, HTTP, security |
| Web | Vitest + RTL | Modes, streaming UI, stores |

Meaningful behavior over coverage percentage. See the test audit checklist exercised under `npm test`.

## 16. Production evolution

Natural next steps (out of scope for this assessment): durable session/history store, Redis rate limits, observability, authN/Z, horizontal SSE sticky routing or gateway buffering controls, stronger RAG (embeddings), prompt/eval harness, and secret management (vault/KMS). Keep `AIProvider` injectable so providers stay swappable.

## 17. What was intentionally NOT implemented

No database, Redis, BullMQ, Socket.io, authentication/JWT, microservices split, OpenAPI YAML, markdown rendering libraries, or client-side Anthropic calls. Ranking and greeting stay non-LLM by design.

## 18. How AI tools were used

Cursor (Composer) was used end-to-end on this monorepo: scaffolding workspaces, shared Zod schemas, ranking and greeting TDD, `AnthropicProvider` and resilience wrappers, Help RAG and conversation streaming, Express middleware and routes, the Next shell with Zustand, SSE client parsing, Talk/Teach/Summary/Help/Greeting UI, security and performance pass-downs, and this documentation. Generated Express route shells, FakeAIProvider-based tests, and SSE parser scaffolding were kept where they matched the architecture. After review, stacked retries between `ConversationService` and `ResilientAIProvider` were removed so only one pre-token transient retry remains; client-facing error sanitization and session header/body mismatch checks were tightened by hand; Summary’s optional 60-second in-memory cache and `startTransition` for token patches were added as small, explicit optimizations rather than broad rewrites. Architecture constraints (no Redis, auth, or database; SSE over POST; deterministic ranking and greeting; FakeAI-only automated tests) were treated as non-negotiable gates instead of letting the model invent out-of-scope infrastructure. Claims in this README match what was built and verified under `npm test` (shared, API, and web suites green).
