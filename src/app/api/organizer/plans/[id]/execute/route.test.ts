import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeOrganizerPlan } from "@/lib/organizer";
import { ORGANIZER_PLAN_EXECUTION_CONFIRMATION } from "@/lib/organizer-confirmations";
import { POST } from "./route";

vi.mock("@/lib/organizer", () => ({
  executeOrganizerPlan: vi.fn(),
}));

describe("/api/organizer/plans/[id]/execute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(executeOrganizerPlan).mockResolvedValue({ id: "plan-1" } as never);
  });

  it("executes only after explicit confirmation", async () => {
    const response = await POST(
      new Request("http://localhost/api/organizer/plans/plan-1/execute", {
        method: "POST",
        body: JSON.stringify({
          confirmation: ORGANIZER_PLAN_EXECUTION_CONFIRMATION,
        }),
      }),
      { params: Promise.resolve({ id: "plan-1" }) },
    );

    expect(response.status).toBe(200);
    expect(executeOrganizerPlan).toHaveBeenCalledWith("plan-1");
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
        }),
      }),
      { params: Promise.resolve({ id: "plan-1" }) },
    );

    expect(response.status).toBe(403);
    expect(executeOrganizerPlan).not.toHaveBeenCalled();
  });
});
