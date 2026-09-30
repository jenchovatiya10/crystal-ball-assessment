import { HealthStatusSchema } from "@crystal-ball/shared";

/**
 * Smoke import so the API package depends on shared types at compile time.
 * No routes are registered here.
 */
export function parseHealthPayload(payload: unknown) {
  return HealthStatusSchema.parse(payload);
}
