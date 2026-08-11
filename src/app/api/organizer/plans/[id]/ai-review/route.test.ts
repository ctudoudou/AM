import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OrganizerAiReviewError,
  reviewOrganizerPlanWithAi,
} from "@/lib/organizer";
import { POST } from "./route";

vi.mock("@/lib/organizer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/organizer")>()),
  reviewOrganizerPlanWithAi: vi.fn(),
}));

describe("/api/organizer/plans/[id]/ai-review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(reviewOrganizerPlanWithAi).mockResolvedValue({
      review: {
        riskLevel: "OK",
        confidence: 0.94,
        summary: "Title and episode match.",
        acceptedSourcePaths: ["/data/downloads/episode.mkv"],
        rejectedSourcePaths: [],
        fileClassifications: [
          {
            sourcePath: "/data/downloads/episode.mkv",
            role: "MAIN_VIDEO",
            mediaType: "ANIME",
            title: "Example",
            season: 1,
            episodeNumber: 1,
            confidence: 0.94,
            evidence: "S01E01",
          },
        ],
      },
      acceptedItems: 1,
      filteredItems: 0,
      flagged: false,
      remainingItems: 1,
      unclassifiedItems: 0,
    });
  });

  it("reviews one plan without executing file moves", async () => {
    const response = await POST(
      new Request("http://localhost/api/organizer/plans/plan-1/ai-review", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "plan-1" }) },
    );

    expect(response.status).toBe(200);
    expect(reviewOrganizerPlanWithAi).toHaveBeenCalledWith("plan-1");
    await expect(response.json()).resolves.toMatchObject({
      review: { riskLevel: "OK", confidence: 0.94 },
      filteredItems: 0,
      flagged: false,
    });
  });

  it("returns a conflict for packages that are too large for a safe AI review", async () => {
    vi.mocked(reviewOrganizerPlanWithAi).mockRejectedValueOnce(
      new OrganizerAiReviewError(
        "ORGANIZER_AI_REVIEW_TOO_LARGE",
        "Split or repair the package before AI review.",
      ),
    );

    const response = await POST(
      new Request("http://localhost/api/organizer/plans/plan-1/ai-review", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "plan-1" }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "ORGANIZER_AI_REVIEW_TOO_LARGE",
    });
  });

  it("rejects cross-origin AI review requests", async () => {
    const response = await POST(
      new Request("http://localhost/api/organizer/plans/plan-1/ai-review", {
        method: "POST",
        headers: { Origin: "https://malicious.example" },
      }),
      { params: Promise.resolve({ id: "plan-1" }) },
    );

    expect(response.status).toBe(403);
    expect(reviewOrganizerPlanWithAi).not.toHaveBeenCalled();
  });
});
