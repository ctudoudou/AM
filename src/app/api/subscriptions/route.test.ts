import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const { download, releaseCandidate, releaseCandidateGroup, subscription, enqueueCandidateDownload } =
  vi.hoisted(() => ({
    download: { findFirst: vi.fn() },
    releaseCandidate: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    releaseCandidateGroup: {
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    subscription: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    enqueueCandidateDownload: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({
  prisma: { download, releaseCandidate, releaseCandidateGroup, subscription },
}));
vi.mock("@/lib/downloads", () => ({ enqueueCandidateDownload }));

const group = {
  id: "group-1",
  mediaType: "ANIME",
  normalizedTitle: "example",
  displayTitle: "Example",
  aliases: ["Example"],
  season: 1,
  reviewRequired: false,
};

function candidate(status: "READY" | "REVIEW", reviewRequired = false) {
  return {
    id: "candidate-1",
    groupId: group.id,
    mediaType: "ANIME",
    rawTitle: "[Group] Example - 01 [1080p]",
    season: 1,
    episodeNumber: 1,
    subtitleGroup: "Group",
    resolution: "1080p",
    codec: "HEVC",
    audio: "AAC",
    subtitleLanguage: "CHT",
    releaseProfile: "WEB-DL",
    sourceKind: "WEB",
    variantKey: "group|1080p|hevc",
    status,
    group: { ...group, reviewRequired },
  };
}

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidateId: "candidate-1", ...body }),
  });
}

describe("POST /api/subscriptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    releaseCandidate.findUniqueOrThrow.mockResolvedValue(candidate("READY"));
    releaseCandidate.update.mockResolvedValue({});
    subscription.findFirst.mockResolvedValue(null);
    subscription.findMany.mockResolvedValue([]);
    subscription.create.mockResolvedValue({ id: "subscription-1" });
    download.findFirst.mockResolvedValue(null);
    enqueueCandidateDownload.mockResolvedValue({ id: "download-1" });
  });

  it("requires explicit confirmation for a REVIEW candidate", async () => {
    releaseCandidate.findUniqueOrThrow.mockResolvedValue(candidate("REVIEW"));

    const response = await POST(request({ autoDownload: false }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("REVIEW_CONFIRMATION_REQUIRED");
    expect(subscription.create).not.toHaveBeenCalled();
  });

  it("blocks automatic download even after a REVIEW candidate is confirmed", async () => {
    releaseCandidate.findUniqueOrThrow.mockResolvedValue(candidate("REVIEW"));

    const response = await POST(
      request({ autoDownload: true, reviewConfirmed: true }),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("REVIEW_AUTO_DOWNLOAD_BLOCKED");
    expect(enqueueCandidateDownload).not.toHaveBeenCalled();
  });

  it("creates a match-only subscription after explicit review confirmation", async () => {
    releaseCandidate.findUniqueOrThrow.mockResolvedValue(candidate("REVIEW"));

    const response = await POST(
      request({ autoDownload: false, reviewConfirmed: true }),
    );

    expect(response.status).toBe(201);
    expect(subscription.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ autoDownload: false }),
      }),
    );
    expect(enqueueCandidateDownload).not.toHaveBeenCalled();
  });

  it("keeps ready candidates eligible for immediate automatic download", async () => {
    const response = await POST(request({ autoDownload: true }));

    expect(response.status).toBe(201);
    expect(enqueueCandidateDownload).toHaveBeenCalledWith("candidate-1");
  });
});
