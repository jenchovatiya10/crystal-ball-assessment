import { config as loadDotenv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));

/** Load monorepo root + apps/api .env files (server-only; never NEXT_PUBLIC_*). */
export function loadDotenvFiles(): void {
  loadDotenv({ path: resolve(here, "../../../../.env") });
  loadDotenv({ path: resolve(here, "../../.env") });
}

/**
 * Server-only environment. Never expose these values to Next.js / NEXT_PUBLIC_*.
 * ANTHROPIC_API_KEY may be omitted locally — the API then uses deterministic fallbacks.
 */
export const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().min(1).optional(),
  ),
  ANTHROPIC_MODEL: z
    .string()
    .trim()
    .min(1, "ANTHROPIC_MODEL is required")
    .default("claude-sonnet-4-20250514"),
  WEB_ORIGIN: z.string().trim().url("WEB_ORIGIN must be a valid URL"),
  API_PORT: z.coerce.number().int().positive().default(3001),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(
  source: NodeJS.ProcessEnv = process.env,
): Env {
  const parsed = EnvSchema.safeParse({
    ANTHROPIC_API_KEY: source.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: source.ANTHROPIC_MODEL,
    WEB_ORIGIN: source.WEB_ORIGIN,
    API_PORT: source.API_PORT ?? source.PORT,
  });

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return parsed.data;
}
