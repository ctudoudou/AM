import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubscriptionReviewGateError } from "@/lib/subscription-review-gate";
import { POST } from "./route";

const { enqueueCandidateDownload } = vi.hoisted(() => ({
  enqueueCandidateDownload: vi.fn(),
}));

vi.mock("@/lib/downloads", () => ({ enqueueCandidateDownload }));

describe("POST /api/release-candidates/:id/download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a conflict when the candidate has not passed review", async () => {
    enqueueCandidateDownload.mockRejectedValue(
      new SubscriptionReviewGateError(
        "CANDIDATE_NOT_READY",
        "This candidate must pass review before it can be downloaded.",
      ),
    );

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "candidate-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("CANDIDATE_NOT_READY");
  });
});
