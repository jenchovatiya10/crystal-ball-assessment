import { describe, expect, it, vi, beforeEach } from "vitest";
import { fetchApprovals } from "@/lib/fetch-approvals";

describe("fetchApprovals", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns parsed approvals from the API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          approvals: [
            {
              id: "apr_pdf_safety_equipment_sensor_specs",
              title: "Safety Equipment & Sensor Specs PDF",
              type: "pdf",
              submittedAt: "2026-09-18T11:15:00.000Z",
              dueAt: "2026-09-30T17:00:00.000Z",
              flags: ["safety"],
            },
          ],
        }),
      }),
    );

    const approvals = await fetchApprovals();
    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.type).toBe("pdf");
  });

  it("returns an empty list when the API is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("offline")),
    );

    await expect(fetchApprovals()).resolves.toEqual([]);
  });
});
