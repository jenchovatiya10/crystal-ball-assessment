import Anthropic from "@anthropic-ai/sdk";
import { ZodError, type ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { AIProvider } from "./AIProvider.js";
import {
  AIInvalidOutputError,
  AIUnavailableError,
} from "./resilience.js";
import type {
  AIMessage,
  GenerateStructuredParams,
  StreamParams,
} from "./types.js";

/** Forced tool used for schema-backed structured generation. */
export const STRUCTURED_TOOL_NAME = "emit_structured_result";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_MAX_TOKENS = 2048;

/**
 * Minimal client port so unit tests can inject a mock without services
 * importing the Anthropic SDK. Production uses a single Anthropic instance.
 */
export type AnthropicClientPort = {
  messages: {
    create: (
      body: Anthropic.MessageCreateParamsNonStreaming,
      options?: { signal?: AbortSignal },
    ) => Promise<Anthropic.Message>;
    stream: (
      body: Anthropic.MessageStreamParams,
      options?: { signal?: AbortSignal },
    ) => AsyncIterable<Anthropic.RawMessageStreamEvent>;
  };
};

export type AnthropicProviderConfig = {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  /** Optional test seam. When omitted, one SDK client is created and reused. */
  client?: AnthropicClientPort;
};

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function toInputSchema(schema: ZodType<unknown>): Anthropic.Tool.InputSchema {
  const jsonSchema = zodToJsonSchema(schema, {
    $refStrategy: "none",
    target: "jsonSchema7",
  }) as Record<string, unknown>;

  // Anthropic tool input_schema expects a plain JSON Schema object.
  delete jsonSchema.$schema;

  if (jsonSchema.type !== "object") {
    throw new AIInvalidOutputError(
      "Structured output schema must describe a JSON object",
    );
  }

  return jsonSchema as Anthropic.Tool.InputSchema;
}

function toAnthropicMessages(
  messages: readonly AIMessage[],
): Anthropic.MessageParam[] {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
}

/**
 * Sole application module allowed to import `@anthropic-ai/sdk`.
 * Services depend only on AIProvider.
 */
export class AnthropicProvider implements AIProvider {
  private readonly client: AnthropicClientPort;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(config: AnthropicProviderConfig = {}) {
    const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY;
    this.model =
      config.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;

    if (config.client) {
      this.client = config.client;
      return;
    }

    if (!apiKey) {
      throw new AIUnavailableError(
        "ANTHROPIC_API_KEY is required on the server",
        { retryable: false },
      );
    }

    // One reused SDK client instance for this provider.
    this.client = new Anthropic({ apiKey });
  }

  async generateStructured<T>(
    params: GenerateStructuredParams<T>,
  ): Promise<T> {
    if (params.signal?.aborted) {
      throw abortFromSignal(params.signal);
    }

    const inputSchema = toInputSchema(params.schema as ZodType<unknown>);
    const tools: Anthropic.Tool[] = [
      {
        name: STRUCTURED_TOOL_NAME,
        description:
          "Emit the final structured result. Do not respond with free-form text.",
        input_schema: inputSchema,
      },
    ];

    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: this.maxTokens,
          system: params.prompt,
          tools,
          tool_choice: { type: "tool", name: STRUCTURED_TOOL_NAME },
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Structured input payload:\n${JSON.stringify(params.input)}`,
                },
              ],
            },
          ],
        },
        params.signal ? { signal: params.signal } : undefined,
      );
    } catch (error) {
      throw mapAnthropicError(error);
    }

    const toolUse = message.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === STRUCTURED_TOOL_NAME,
    );

    if (!toolUse) {
      throw new AIInvalidOutputError(
        "Anthropic response did not include the required structured tool output",
      );
    }

    // Validate the tool input object with Zod — never regex-parse assistant text.
    try {
      return params.schema.parse(toolUse.input);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new AIInvalidOutputError(
          "Anthropic structured tool output failed Zod validation",
          error,
        );
      }
      throw error;
    }
  }

  async *stream(params: StreamParams): AsyncIterable<string> {
    if (params.signal?.aborted) {
      throw abortFromSignal(params.signal);
    }

    const anthropicMessages = toAnthropicMessages(params.messages);
    if (anthropicMessages.length === 0) {
      anthropicMessages.push({
        role: "user",
        content: "Continue.",
      });
    }

    let stream: AsyncIterable<Anthropic.RawMessageStreamEvent>;
    try {
      stream = this.client.messages.stream(
        {
          model: this.model,
          max_tokens: this.maxTokens,
          system: params.prompt,
          messages: anthropicMessages,
        },
        params.signal ? { signal: params.signal } : undefined,
      );
    } catch (error) {
      throw mapAnthropicError(error);
    }

    try {
      for await (const event of stream) {
        if (params.signal?.aborted) {
          throw abortFromSignal(params.signal);
        }
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          yield event.delta.text;
        }
      }
    } catch (error) {
      throw mapAnthropicError(error);
    }
  }
}

function abortFromSignal(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}

function mapAnthropicError(error: unknown): Error {
  if (isAbortError(error)) {
    return error as Error;
  }

  if (error instanceof AIInvalidOutputError || error instanceof AIUnavailableError) {
    return error;
  }

  if (error instanceof Anthropic.APIError) {
    const status = error.status;
    return new AIUnavailableError(error.message, {
      retryable: status == null || status >= 500,
      status: status ?? undefined,
      cause: error,
    });
  }

  if (error instanceof Error) {
    return new AIUnavailableError(error.message, {
      retryable: true,
      cause: error,
    });
  }

  return new AIUnavailableError("Anthropic provider request failed", {
    retryable: true,
    cause: error,
  });
}
