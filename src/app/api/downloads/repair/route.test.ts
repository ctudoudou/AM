import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DOWNLOAD_REPAIR_CONFIRMATION,
  DownloadRepairPlanStaleError,
  createDownloadRepairPlan,
  executeDownloadRepairPlan,
} from "@/lib/download-repair";
import { GET, POST } from "./route";

vi.mock("@/lib/download-repair", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/download-repair")>();
  return {
    ...actual,
    createDownloadRepairPlan: vi.fn(),
    executeDownloadRepairPlan: vi.fn(),
  };
});

const plan = {
  planId: "a".repeat(64),
  createdAt: "2026-01-01T00:00:00.000Z",
  downloadsDir: "/data/downloads",
  warnings: [],
  summary: {
    failed: 1,
    knownAria2: 0,
    executable: 1,
    review: 0,
    byKind: {
      sync_existing_gid: 0,
      adopt_aria2_gid: 0,
      mark_completed: 0,
      retry_source: 1,
      supersede_duplicate: 0,
      manual_review: 0,
    },
  },
  items: [],
};

describe("/api/downloads/repair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createDownloadRepairPlan).mockResolvedValue(plan);
    vi.mocked(executeDownloadRepairPlan).mockResolvedValue({
      planId: plan.planId,
      requested: 1,
      succeeded: 1,
      failed: 0,
      skipped: 0,
      results: [],
    });
  });

  it("returns a dry-run plan without executing changes", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ planId: plan.planId });
    expect(executeDownloadRepairPlan).not.toHaveBeenCalled();
  });

  it("executes only an explicitly confirmed current plan", async () => {
    const response = await POST(
      new Request("http://localhost/api/downloads/repair", {
        method: "POST",
        body: JSON.stringify({
          planId: plan.planId,
          actionIds: ["retry_source:one"],
          confirmation: DOWNLOAD_REPAIR_CONFIRMATION,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(executeDownloadRepairPlan).toHaveBeenCalledWith({
      planId: plan.planId,
      actionIds: ["retry_source:one"],
      confirmation: DOWNLOAD_REPAIR_CONFIRMATION,
    });
  });

  it("rejects execution when the dry-run plan is stale", async () => {
    vi.mocked(executeDownloadRepairPlan).mockRejectedValue(
      new DownloadRepairPlanStaleError("stale plan"),
    );
    const response = await POST(
      new Request("http://localhost/api/downloads/repair", {
        method: "POST",
        body: JSON.stringify({
          planId: plan.planId,
          actionIds: ["retry_source:one"],
          confirmation: DOWNLOAD_REPAIR_CONFIRMATION,
        }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "STALE_DOWNLOAD_REPAIR_PLAN" });
  });

  it("rejects a missing confirmation phrase before execution", async () => {
    const response = await POST(
      new Request("http://localhost/api/downloads/repair", {
        method: "POST",
        body: JSON.stringify({
          planId: plan.planId,
          actionIds: ["retry_source:one"],
          confirmation: "yes",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(executeDownloadRepairPlan).not.toHaveBeenCalled();
  });
});
