import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORGANIZER_AI_CLASSIFICATION_CONFIRMATION } from "@/lib/organizer-confirmations";
import { applyOrganizerAiClassification } from "@/lib/organizer";
import { POST } from "./route";

vi.mock("@/lib/organizer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/organizer")>()),
  applyOrganizerAiClassification: vi.fn(),
}));

describe("/api/organizer/plans/[id]/ai-review/apply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(applyOrganizerAiClassification).mockResolvedValue({
      plan: { id: "plan-1" },
      updatedItems: 1,
      excludedItems: 0,
      conflicts: 0,
    } as never);
  });

  it("applies a reviewed classification without moving files", async () => {
    const planVersion = "a".repeat(64);
    const response = await POST(
      new Request("http://localhost/api/organizer/plans/plan-1/ai-review/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmation: ORGANIZER_AI_CLASSIFICATION_CONFIRMATION,
          planVersion,
        }),
      }),
      { params: Promise.resolve({ id: "plan-1" }) },
    );

    expect(response.status).toBe(200);
    expect(applyOrganizerAiClassification).toHaveBeenCalledWith({
      planId: "plan-1",
      expectedVersion: planVersion,
      confirmation: ORGANIZER_AI_CLASSIFICATION_CONFIRMATION,
    });
  });
});
