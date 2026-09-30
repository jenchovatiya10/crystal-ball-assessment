import {
  ApprovalSchema,
  HelpResponseSchema,
  SummaryResponseSchema,
  type Approval,
  type HelpResponse,
  type Language,
  type SummaryResponse,
} from "@crystal-ball/shared";
import { readSseStream, type ParsedSseEvent } from "@/lib/sseParser";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;

  constructor(
    message: string,
    options: { status: number; code?: string; requestId?: string },
  ) {
    super(message);
    this.name = "ApiClientError";
    this.status = options.status;
    this.code = options.code ?? "HTTP_ERROR";
    if (options.requestId !== undefined) {
      this.requestId = options.requestId;
    }
  }
}

export type GreetingApiResponse = {
  greeting: string;
  meta: {
    dayPart: string;
    totalCount: number;
    urgency: Record<string, number>;
    highestPriorityApprovalId: string | null;
    highestPriorityTitle: string | null;
    language: string;
  };
};

export type SummaryApiResponse = {
  data: SummaryResponse;
  meta: {
    source: "ai" | "fallback";
    reason?: string;
    promptVersion: string;
  };
};

export type HelpApiResponse = {
  data: HelpResponse;
  meta: {
    source: "ai" | "fallback";
    reason?: string;
    promptVersion: string;
  };
};

export type StreamRequest = {
  sessionId: string;
  message: string;
  language?: Language;
  signal?: AbortSignal;
};

/** Browser/server API base — never includes Anthropic secrets. */
export function getApiBaseUrl(
  env: { NEXT_PUBLIC_API_URL?: string | undefined } = {
    NEXT_PUBLIC_API_URL: process.env["NEXT_PUBLIC_API_URL"],
  },
): string {
  return (env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001").replace(
    /\/$/,
    "",
  );
}

function buildUrl(path: string, query?: Record<string, string | undefined>): string {
  const url = new URL(path, `${getApiBaseUrl()}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    }
  }
  return url.toString();
}

async function parseError(response: Response): Promise<ApiClientError> {
  let code = "HTTP_ERROR";
  let message = `Request failed with status ${response.status}`;
  let requestId: string | undefined = response.headers.get("x-request-id") ?? undefined;

  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as { error: unknown }).error === "object" &&
      (body as { error: unknown }).error !== null
    ) {
      const error = (body as {
        error: { code?: unknown; message?: unknown; requestId?: unknown };
      }).error;
      if (typeof error.code === "string") code = error.code;
      if (typeof error.message === "string") message = error.message;
      if (typeof error.requestId === "string") requestId = error.requestId;
    }
  } catch {
    // Keep generic message when body is not JSON.
  }

  return new ApiClientError(message, {
    status: response.status,
    code,
    requestId,
  });
}

async function requestJson<T>(
  path: string,
  init: RequestInit & { sessionId?: string },
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (init.sessionId) {
    headers.set("X-Session-Id", init.sessionId);
  }

  const { sessionId: _sessionId, ...fetchInit } = init;
  const response = await fetch(buildUrl(path), {
    ...fetchInit,
    headers,
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  return (await response.json()) as T;
}

export async function getApprovals(): Promise<Approval[]> {
  const json = await requestJson<{ approvals: unknown }>("api/approvals", {
    method: "GET",
    cache: "no-store",
  });
  if (!Array.isArray(json.approvals)) {
    return [];
  }
  return json.approvals.flatMap((item) => {
    const parsed = ApprovalSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export async function getGreeting(options: {
  sessionId: string;
  language?: Language;
  signal?: AbortSignal;
}): Promise<GreetingApiResponse> {
  const url = buildUrl("api/assistant/greeting", {
    language: options.language,
  });
  const headers = new Headers({
    Accept: "application/json",
    "X-Session-Id": options.sessionId,
  });
  const response = await fetch(url, {
    method: "GET",
    headers,
    signal: options.signal,
    cache: "no-store",
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  return (await response.json()) as GreetingApiResponse;
}

export async function getSummary(options: {
  sessionId: string;
  language?: Language;
  signal?: AbortSignal;
}): Promise<SummaryApiResponse> {
  const json = await requestJson<{
    data: unknown;
    meta: SummaryApiResponse["meta"];
  }>("api/assistant/summary", {
    method: "POST",
    sessionId: options.sessionId,
    signal: options.signal,
    body: JSON.stringify({
      ...(options.language ? { language: options.language } : {}),
    }),
  });

  const data = SummaryResponseSchema.parse(json.data);
  return { data, meta: json.meta };
}

export async function getHelp(options: {
  sessionId: string;
  question: string;
  language?: Language;
  signal?: AbortSignal;
}): Promise<HelpApiResponse> {
  const json = await requestJson<{
    data: unknown;
    meta: HelpApiResponse["meta"];
  }>("api/assistant/help", {
    method: "POST",
    sessionId: options.sessionId,
    signal: options.signal,
    body: JSON.stringify({
      question: options.question,
      ...(options.language ? { language: options.language } : {}),
    }),
  });

  const data = HelpResponseSchema.parse(json.data);
  return { data, meta: json.meta };
}

async function openAssistantStream(
  path: "api/assistant/chat" | "api/assistant/teach",
  options: StreamRequest,
): Promise<ReadableStream<Uint8Array>> {
  const headers = new Headers({
    Accept: "text/event-stream",
    "Content-Type": "application/json",
    "X-Session-Id": options.sessionId,
  });

  const response = await fetch(buildUrl(path), {
    method: "POST",
    headers,
    signal: options.signal,
    body: JSON.stringify({
      sessionId: options.sessionId,
      message: options.message,
      ...(options.language ? { language: options.language } : {}),
    }),
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  if (!response.body) {
    throw new ApiClientError("Streaming response body was empty", {
      status: response.status,
      code: "EMPTY_STREAM",
    });
  }

  return response.body;
}

export async function* streamChat(
  options: StreamRequest,
): AsyncGenerator<ParsedSseEvent, void, undefined> {
  const body = await openAssistantStream("api/assistant/chat", options);
  yield* readSseStream(body, { signal: options.signal });
}

export async function* streamTeach(
  options: StreamRequest,
): AsyncGenerator<ParsedSseEvent, void, undefined> {
  const body = await openAssistantStream("api/assistant/teach", options);
  yield* readSseStream(body, { signal: options.signal });
}

export const apiClient = {
  getApprovals,
  getGreeting,
  getSummary,
  getHelp,
  streamChat,
  streamTeach,
};
