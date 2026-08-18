import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDownloadReconciliationPlan,
  DOWNLOAD_RECONCILIATION_CONFIRMATION,
  DownloadReconciliationPlanStaleError,
  executeDownloadReconciliationPlan,
} from "@/lib/download-reconciliation";
import { GET, POST } from "./route";

vi.mock("@/lib/download-reconciliation", () => ({
  DOWNLOAD_RECONCILIATION_CONFIRMATION:
    "I understand this pauses verified archived aria2 tasks",
  DownloadReconciliationPlanStaleError: class extends Error {},
  DownloadReconciliationValidationError: class extends Error {},
  createDownloadReconciliationPlan: vi.fn(),
  executeDownloadReconciliationPlan: vi.fn(),
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
        stalledTracked: 0,
        safePause: 0,
        manualReview: 1,
        byKind: {
          archived_active: 0,
          archived_result: 0,
          untracked_payload: 1,
          untracked_metadata: 0,
          untracked_error: 0,
          stalled_tracked: 0,
          ambiguous_match: 0,
        },
      },
      items: [],
    });
    vi.mocked(executeDownloadReconciliationPlan).mockResolvedValue({
      planId: "a".repeat(64),
      requested: 1,
      succeeded: 1,
      failed: 0,
      results: [],
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

  it("executes an explicitly confirmed current reconciliation plan", async () => {
    const response = await POST(
      new Request("http://localhost/api/downloads/reconciliation", {
        method: "POST",
        body: JSON.stringify({
          planId: "a".repeat(64),
          actionIds: ["archived_active:one"],
          confirmation: DOWNLOAD_RECONCILIATION_CONFIRMATION,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(executeDownloadReconciliationPlan).toHaveBeenCalledWith({
      planId: "a".repeat(64),
      actionIds: ["archived_active:one"],
      confirmation: DOWNLOAD_RECONCILIATION_CONFIRMATION,
    });
  });

  it("rejects a stale reconciliation plan", async () => {
    vi.mocked(executeDownloadReconciliationPlan).mockRejectedValue(
      new DownloadReconciliationPlanStaleError("stale plan"),
    );

    const response = await POST(
      new Request("http://localhost/api/downloads/reconciliation", {
        method: "POST",
        body: JSON.stringify({
          planId: "a".repeat(64),
          actionIds: ["archived_active:one"],
          confirmation: DOWNLOAD_RECONCILIATION_CONFIRMATION,
        }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "STALE_DOWNLOAD_RECONCILIATION_PLAN",
    });
  });

  it("rejects execution without the exact confirmation phrase", async () => {
    const response = await POST(
      new Request("http://localhost/api/downloads/reconciliation", {
        method: "POST",
        body: JSON.stringify({
          planId: "a".repeat(64),
          actionIds: ["archived_active:one"],
          confirmation: "yes",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(executeDownloadReconciliationPlan).not.toHaveBeenCalled();
  });

  it("rejects cross-origin pause requests", async () => {
    const response = await POST(
      new Request("http://localhost/api/downloads/reconciliation", {
        method: "POST",
        headers: { Origin: "https://malicious.example" },
        body: JSON.stringify({
          planId: "a".repeat(64),
          actionIds: ["archived_active:one"],
          confirmation: DOWNLOAD_RECONCILIATION_CONFIRMATION,
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "UNTRUSTED_ORIGIN" });
    expect(executeDownloadReconciliationPlan).not.toHaveBeenCalled();
  });
});
