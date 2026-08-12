import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DATA_HEALTH_REPAIR_CONFIRMATION,
  createDataHealthRepairPlan,
  repairDataHealth,
} from "@/lib/data-health";
import { POST } from "./route";

vi.mock("@/lib/data-health", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data-health")>();
  return {
    ...actual,
    createDataHealthRepairPlan: vi.fn(),
    repairDataHealth: vi.fn(),
  };
});

const plan = {
  planId: "a".repeat(64),
  createdAt: "2026-08-11T00:00:00.000Z",
  generatedFrom: "2026-08-11T00:00:00.000Z",
  actions: [],
  summary: { actions: 0, affectedRecords: 0, highConfidenceActions: 0 },
};

describe("/api/data-health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createDataHealthRepairPlan).mockResolvedValue(plan);
  });

  it("returns a dry-run plan without executing a repair", async () => {
    const response = await POST(
      new Request("http://localhost/api/data-health", {
        method: "POST",
        body: JSON.stringify({ mode: "preview" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ planId: plan.planId });
    expect(repairDataHealth).not.toHaveBeenCalled();
  });

  it("executes only an explicitly selected and confirmed current plan", async () => {
    vi.mocked(repairDataHealth).mockResolvedValue({
      planId: plan.planId,
      requested: 1,
      succeeded: 1,
      failed: 0,
      results: [],
      scan: {
        generatedAt: "2026-08-11T00:00:01.000Z",
        summary: {
          score: 100,
          candidatesScanned: 0,
          parserReplayIssues: 0,
          pollutedGroups: 0,
          splitGroups: 0,
          organizerIssues: 0,
          pollutedMediaFiles: 0,
          noisyMovieMetadataAliases: 0,
          autoFixableIssues: 0,
        },
        issues: [],
      },
    });

    const input = {
      mode: "execute" as const,
      planId: plan.planId,
      actionIds: ["organizer_plans" as const],
      confirmation: DATA_HEALTH_REPAIR_CONFIRMATION,
    };
    const response = await POST(
      new Request("http://localhost/api/data-health", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    );

    expect(response.status).toBe(200);
    expect(repairDataHealth).toHaveBeenCalledWith(input);
  });

  it("rejects execute requests without the exact confirmation phrase", async () => {
    const response = await POST(
      new Request("http://localhost/api/data-health", {
        method: "POST",
        body: JSON.stringify({
          mode: "execute",
          planId: plan.planId,
          actionIds: ["organizer_plans"],
          confirmation: "yes",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(repairDataHealth).not.toHaveBeenCalled();
  });
});
