export type SseEventName = "meta" | "token" | "done" | "error" | (string & {});

export type ParsedSseEvent = {
  event: SseEventName;
  data: unknown;
  rawData: string;
};

/**
 * Incremental SSE frame parser.
 * Buffers chunks, splits on blank lines (`\n\n`), and supports partial frames.
 */
export class SseParser {
  private buffer = "";

  push(chunk: string): ParsedSseEvent[] {
    this.buffer += chunk.replace(/\r\n/g, "\n");
    const events: ParsedSseEvent[] = [];

    while (true) {
      const separatorIndex = this.buffer.indexOf("\n\n");
      if (separatorIndex === -1) {
        break;
      }

      const rawFrame = this.buffer.slice(0, separatorIndex);
      this.buffer = this.buffer.slice(separatorIndex + 2);

      const parsed = parseSseFrame(rawFrame);
      if (parsed) {
        events.push(parsed);
      }
    }

    return events;
  }

  /** Remaining unparsed buffer (incomplete frame). */
  getPending(): string {
    return this.buffer;
  }

  reset(): void {
    this.buffer = "";
  }
}

export function parseSseFrame(rawFrame: string): ParsedSseEvent | null {
  const trimmed = rawFrame.trim();
  if (!trimmed) {
    return null;
  }

  let event: SseEventName = "message";
  const dataLines: string[] = [];

  for (const line of trimmed.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim() as SseEventName;
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }

  const rawData = dataLines.join("\n");
  let data: unknown = rawData;
  if (rawData.length > 0) {
    try {
      data = JSON.parse(rawData) as unknown;
    } catch {
      data = rawData;
    }
  } else {
    data = {};
  }

  return { event, data, rawData };
}

/**
 * Read a fetch ReadableStream as parsed SSE events.
 * Honours AbortSignal and incomplete multi-chunk frames.
 */
export async function* readSseStream(
  stream: ReadableStream<Uint8Array>,
  options: { signal?: AbortSignal } = {},
): AsyncGenerator<ParsedSseEvent, void, undefined> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();

  const onAbort = () => {
    void reader.cancel("aborted");
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    if (options.signal?.aborted) {
      throw abortError(options.signal);
    }

    while (true) {
      if (options.signal?.aborted) {
        throw abortError(options.signal);
      }

      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const text = decoder.decode(value, { stream: true });
      const events = parser.push(text);
      for (const event of events) {
        yield event;
      }
    }

    // Flush decoder tail; incomplete SSE frame stays pending by design.
    const tail = decoder.decode();
    if (tail) {
      for (const event of parser.push(tail)) {
        yield event;
      }
    }
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}
