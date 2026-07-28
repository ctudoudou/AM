import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  executeOrganizerPlan,
  OrganizerPlanStaleError,
} from "@/lib/organizer";
import { ORGANIZER_PLAN_EXECUTION_CONFIRMATION } from "@/lib/organizer-confirmations";
import { POST } from "./route";

vi.mock("@/lib/organizer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/organizer")>()),
  executeOrganizerPlan: vi.fn(),
}));

const planVersion = "a".repeat(64);

describe("/api/organizer/plans/[id]/execute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.KURA_BUILD_SHA = "test-revision";
    vi.mocked(executeOrganizerPlan).mockResolvedValue({ id: "plan-1" } as never);
  });

  it("executes only after explicit confirmation", async () => {
    const response = await POST(
      new Request("http://localhost/api/organizer/plans/plan-1/execute", {
        method: "POST",
        body: JSON.stringify({
          confirmation: ORGANIZER_PLAN_EXECUTION_CONFIRMATION,
          clientRevision: "test-revision",
          planVersion,
        }),
      }),
      { params: Promise.resolve({ id: "plan-1" }) },
    );

    expect(response.status).toBe(200);
    expect(executeOrganizerPlan).toHaveBeenCalledWith("plan-1", false, planVersion);
  });

  it("rejects an unconfirmed execution before moving files", async () => {
    const response = await POST(
      new Request("http://localhost/api/organizer/plans/plan-1/execute", {
        method: "POST",
        body: JSON.stringify({ confirmation: "yes" }),
      }),
      { params: Promise.resolve({ id: "plan-1" }) },
    );

    expect(response.status).toBe(400);
    expect(executeOrganizerPlan).not.toHaveBeenCalled();
  });

  it("rejects cross-origin execution even with confirmation", async () => {
    const response = await POST(
      new Request("http://localhost/api/organizer/plans/plan-1/execute", {
        method: "POST",
        headers: { Origin: "https://malicious.example" },
        body: JSON.stringify({
          confirmation: ORGANIZER_PLAN_EXECUTION_CONFIRMATION,
          clientRevision: "test-revision",
          planVersion,
        }),
      }),
      { params: Promise.resolve({ id: "plan-1" }) },
    );

    expect(response.status).toBe(403);
    expect(executeOrganizerPlan).not.toHaveBeenCalled();
  });

  it("rejects a page rendered by a different build", async () => {
    const response = await POST(
      new Request("http://localhost/api/organizer/plans/plan-1/execute", {
        method: "POST",
        body: JSON.stringify({
          confirmation: ORGANIZER_PLAN_EXECUTION_CONFIRMATION,
          clientRevision: "old-revision",
          planVersion,
        }),
      }),
      { params: Promise.resolve({ id: "plan-1" }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "BUILD_REVISION_MISMATCH",
    });
    expect(executeOrganizerPlan).not.toHaveBeenCalled();
  });

  it("returns a conflict when the reviewed plan snapshot is stale", async () => {
    vi.mocked(executeOrganizerPlan).mockRejectedValueOnce(
      new OrganizerPlanStaleError("stale"),
    );
    const response = await POST(
      new Request("http://localhost/api/organizer/plans/plan-1/execute", {
        method: "POST",
        body: JSON.stringify({
          confirmation: ORGANIZER_PLAN_EXECUTION_CONFIRMATION,
          clientRevision: "test-revision",
          planVersion,
        }),
      }),
      { params: Promise.resolve({ id: "plan-1" }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "ORGANIZER_PLAN_STALE",
    });
  });
});
