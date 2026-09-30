# API contract

Base URL: `http://localhost:3001` (or `NEXT_PUBLIC_API_URL`).

Common headers:

| Header | Required | Notes |
|--------|----------|--------|
| `X-Session-Id` | Yes on assistant AI routes | UUID |
| `X-Request-Id` | No | Echoed when provided; otherwise generated |
| `Content-Type` | `application/json` on JSON bodies | |
| `Accept` | `application/json` or `text/event-stream` | Streams prefer SSE |

Generic error envelope (JSON routes):

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Request validation failed",
    "requestId": "…"
  }
}
```

---

## Endpoints

### `GET /api/health`

| | |
|--|--|
| Auth / session | None |
| Request | — |
| Response `200` | `{ "ok": true }` |

### `GET /api/approvals`

| | |
|--|--|
| Session | Not required |
| Response `200` | `{ "approvals": Approval[] }` seeded fixtures |

### `POST /api/assistant/summary`

| | |
|--|--|
| Session | `X-Session-Id` required |
| Rate limit | Yes |
| Body | `{ "language"?: "en" \| "es" }` (strict) |

**Success `200`**

| Field | Type |
|-------|------|
| `data` | `SummaryResponse` (`overview`, `priorityItems[]`, `recommendedNextAction`) |
| `meta.source` | `"ai"` \| `"fallback"` |
| `meta.reason` | optional (`timeout`, `invalid_output`, `unavailable`) |
| `meta.promptVersion` | e.g. `summary.v1` |

### `POST /api/assistant/help`

| | |
|--|--|
| Session | `X-Session-Id` required |
| Rate limit | Yes |
| Body | `{ "question": string, "language"?: "en" \| "es" }` |

**Success `200`**

| Field | Type |
|-------|------|
| `data.answer` | string |
| `data.sources` | string[] (chunk IDs) |
| `data.grounded` | boolean |
| `meta.source` | `"ai"` \| `"fallback"` |
| `meta.reason` | optional (`no_sources`, `timeout`, `invalid_output`, `unavailable`) |
| `meta.promptVersion` | e.g. `help.v1` |

When retrieval finds nothing: `grounded=false`, empty `sources`, `meta.reason: "no_sources"` — **no LLM call**.

### `POST /api/assistant/chat`

| | |
|--|--|
| Session | `X-Session-Id` **and** body `sessionId` (must match) |
| Rate limit | Yes |
| Body | `{ "sessionId": uuid, "message": string, "language"?: "en" \| "es" }` |
| Response | SSE (`text/event-stream`) |

### `POST /api/assistant/teach`

Same shape as chat; SSE coaching stream (`teach.v1`).

### `GET /api/assistant/greeting`

| | |
|--|--|
| Session | `X-Session-Id` required |
| Rate limit | Yes |
| Query | `language?` = `en` \| `es` |

**Success `200`**

| Field | Type |
|-------|------|
| `greeting` | string (deterministic) |
| `meta.dayPart` | `morning` \| `afternoon` \| `evening` |
| `meta.totalCount` | number |
| `meta.urgency` | counts by priority |
| `meta.highestPriorityApprovalId` | string \| null |
| `meta.highestPriorityTitle` | string \| null |
| `meta.language` | string |

---

## SSE events (chat / teach)

Frames separated by `\n\n`. Shape: `event: <name>\ndata: <json>\n\n`.

| Event | Data | Notes |
|-------|------|--------|
| `meta` | `{ sessionId, requestId }` | First |
| `token` | `{ t: string }` | Zero or more |
| `done` | `{}` or `{ fallback: true }` | Terminal success / fallback |
| `error` | `{ code, message, fallback: true }` | Terminal; message is sanitized |

Ordering: **`meta` → `token*` → (`done` \| `error`)**.

Client: `fetch` POST + `ReadableStreamDefaultReader` (not `EventSource`).

---

## Error codes (representative)

| HTTP | `error.code` | When |
|------|--------------|------|
| 400 | `INVALID_SESSION_ID` | Bad/missing `X-Session-Id` |
| 400 | `SESSION_MISMATCH` | Chat/teach body `sessionId` ≠ header |
| 400 | `BAD_REQUEST` | Zod validation failure |
| 404 | `NOT_FOUND` | Unknown route |
| 413 | `PAYLOAD_TOO_LARGE` | Body over JSON limit (~10kb) |
| 429 | `RATE_LIMITED` | Too many AI requests (`Retry-After` set) |
| 500 | `INTERNAL_ERROR` | Unexpected (no stack leakage) |

---

## Approval object (reference)

| Field | Type |
|-------|------|
| `id` | string |
| `title` | string |
| `type` | `folder` \| `video` \| `pdf` \| `image` |
| `submittedAt` | ISO-8601 datetime |
| `dueAt` | ISO-8601 datetime |
| `flags` | string[] |
