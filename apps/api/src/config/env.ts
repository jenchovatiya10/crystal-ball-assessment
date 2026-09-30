import { z } from "zod";

/**
 * Server-only environment. Never expose these values to Next.js / NEXT_PUBLIC_*.
 */
export const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().trim().min(1, "ANTHROPIC_API_KEY is required"),
  ANTHROPIC_MODEL: z.string().trim().min(1, "ANTHROPIC_MODEL is required"),
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
