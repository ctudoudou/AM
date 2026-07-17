import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDownloadReconciliationPlan } from "@/lib/download-reconciliation";
import { GET } from "./route";

vi.mock("@/lib/download-reconciliation", () => ({
  createDownloadReconciliationPlan: vi.fn(),
}));

describe("/api/downloads/reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createDownloadReconciliationPlan).mockResolvedValue({
      planId: "a".repeat(64),
      createdAt: "2026-07-17T00:00:00.000Z",
      warnings: [],
      summary: {
        downloads: 1,
        knownAria2: 1,
        trackedAria2: 0,
        untrackedAria2: 1,
        anomalies: 1,
        archivedActive: 0,
        safePause: 0,
        manualReview: 1,
        byKind: {
          archived_active: 0,
          archived_result: 0,
          untracked_payload: 1,
          untracked_metadata: 0,
          untracked_error: 0,
          ambiguous_match: 0,
        },
      },
      items: [],
    });
  });

  it("returns a read-only reconciliation plan", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      summary: { untrackedAria2: 1 },
    });
    expect(createDownloadReconciliationPlan).toHaveBeenCalledOnce();
  });
});
