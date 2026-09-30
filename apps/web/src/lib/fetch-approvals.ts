import { ApprovalSchema, type Approval } from "@crystal-ball/shared";

/**
 * Server-side fetch of seeded approvals. Returns [] if the API is unreachable
 * so Next builds remain resilient without a live backend.
 */
export async function fetchApprovals(): Promise<Approval[]> {
  const baseUrl =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:3001";

  try {
    const response = await fetch(`${baseUrl}/api/approvals`, {
      cache: "no-store",
    });
    if (!response.ok) {
      return [];
    }
    const json: unknown = await response.json();
    if (
      typeof json !== "object" ||
      json === null ||
      !("approvals" in json) ||
      !Array.isArray((json as { approvals: unknown }).approvals)
    ) {
      return [];
    }

    return (json as { approvals: unknown[] }).approvals.flatMap((item) => {
      const parsed = ApprovalSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
  } catch {
    return [];
  }
}
