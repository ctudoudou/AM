import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { listNoisyMovieMetadataAliases } from "@/lib/metadata";
import {
  detectCandidateReplayIssue,
  isSuspiciousTitleToken,
  scanDataHealth,
  sumDataHealthIssueCounts,
} from "./data-health";

vi.mock("@/lib/db", () => ({
  prisma: {
    releaseCandidate: { findMany: vi.fn() },
    releaseCandidateGroup: { findMany: vi.fn() },
    organizerPlan: { findMany: vi.fn() },
    mediaFile: { findMany: vi.fn(), count: vi.fn() },
  },
}));

vi.mock("@/lib/candidate-grouper", () => ({
  repairCandidateGroups: vi.fn(),
}));

vi.mock("@/lib/organizer", () => ({
  cleanupPollutedOrganizerPlans: vi.fn(),
  cleanupStaleOrganizerPlans: vi.fn(),
  organizerTargetPathLooksPolluted: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/metadata", () => ({
  cleanupNoisyMovieMetadataAliases: vi.fn(),
  listNoisyMovieMetadataAliases: vi.fn(),
}));

vi.mock("@/lib/wanted-episodes", () => ({
  repairAnimeEpisodeNumbering: vi.fn(),
}));

describe("data health helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.releaseCandidate.findMany).mockResolvedValue([]);
    vi.mocked(prisma.releaseCandidateGroup.findMany).mockResolvedValue([]);
    vi.mocked(prisma.organizerPlan.findMany).mockResolvedValue([]);
    vi.mocked(prisma.mediaFile.findMany).mockResolvedValue([]);
    vi.mocked(prisma.mediaFile.count).mockResolvedValue(0);
    vi.mocked(listNoisyMovieMetadataAliases).mockResolvedValue([]);
  });

  it("flags parser replay drift for release edition titles stored as media titles", () => {
    const issue = detectCandidateReplayIssue({
      id: "candidate-1",
      groupId: "group-1",
      mediaType: "ANIME",
      rawTitle:
        "[黒ネズミたち] 淫獄團地 [年齡限制版] / Ingoku Danchi - 07 (Baha 1920x1080 AVC AAC MP4)",
      parsedTitle: "年齡限制版",
      normalizedTitle: "年龄限制版",
      episodeNumber: 7,
      season: null,
      group: {
        id: "group-1",
        displayTitle: "年龄限制版",
        normalizedTitle: "年龄限制版",
        aliases: [],
      },
    });

    expect(issue?.newParsedTitle).toBe("淫獄團地 / Ingoku Danchi");
    expect(issue?.newNormalizedTitle).toBe("淫狱团地");
  });

  it("does not flag stable candidate identity", () => {
    const issue = detectCandidateReplayIssue({
      id: "candidate-1",
      groupId: "group-1",
      mediaType: "ANIME",
      rawTitle: "[Group] Some Anime - 03 [1080p][AVC AAC]",
      parsedTitle: "Some Anime",
      normalizedTitle: "some anime",
      episodeNumber: 3,
      season: null,
      group: {
        id: "group-1",
        displayTitle: "Some Anime",
        normalizedTitle: "some anime",
        aliases: [],
      },
    });

    expect(issue).toBeNull();
  });

  it("recognizes non-title pollution tokens", () => {
    expect(isSuspiciousTitleToken("简／繁")).toBe(true);
    expect(isSuspiciousTitleToken("1080p")).toBe(true);
    expect(isSuspiciousTitleToken("Some Anime")).toBe(false);
  });

  it("uses the number of affected records instead of the number of issue buckets", () => {
    expect(sumDataHealthIssueCounts([{ count: 26 }])).toBe(26);
    expect(sumDataHealthIssueCounts([{ count: 5 }, { count: 3 }])).toBe(8);
    expect(sumDataHealthIssueCounts([])).toBe(0);
  });

  it("reports every split title in the overview and fetches only scan fields", async () => {
    const group = (id: string, displayTitle: string, normalizedTitle: string) => ({
      id,
      displayTitle,
      normalizedTitle,
      aliases: [],
    });
    const candidate = (
      id: string,
      groupId: string,
      rawTitle: string,
      candidateGroup: ReturnType<typeof group>,
    ) => ({
      id,
      groupId,
      mediaType: "ANIME" as const,
      rawTitle,
      parsedTitle: candidateGroup.displayTitle,
      normalizedTitle: candidateGroup.normalizedTitle,
      episodeNumber: 1,
      season: 1,
      group: candidateGroup,
    });
    const groups = [
      group("g-1", "Some Anime", "some anime"),
      group("g-2", "Some Anime Alt", "some anime alt"),
      group("g-3", "Other Anime", "other anime"),
      group("g-4", "Other Anime Alt", "other anime alt"),
    ];

    vi.mocked(prisma.releaseCandidate.findMany).mockResolvedValue([
      candidate("c-1", "g-1", "[A] Some Anime - 01 [1080p]", groups[0]!),
      candidate("c-2", "g-2", "[B] Some Anime - 02 [1080p]", groups[1]!),
      candidate("c-3", "g-3", "[A] Other Anime - 01 [1080p]", groups[2]!),
      candidate("c-4", "g-4", "[B] Other Anime - 02 [1080p]", groups[3]!),
    ] as never);
    vi.mocked(prisma.releaseCandidateGroup.findMany).mockResolvedValue(
      groups.map((item) => ({
        ...item,
        _count: { candidates: 1, subscriptions: 0 },
      })) as never,
    );

    const scan = await scanDataHealth();

    expect(scan.summary.splitGroups).toBe(2);
    expect(scan.issues.find((issue) => issue.type === "split_group")?.count).toBe(2);
    expect(prisma.releaseCandidate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          id: true,
          rawTitle: true,
          group: expect.any(Object),
        }),
      }),
    );
    expect(prisma.releaseCandidate.findMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ include: expect.anything() }),
    );
  });
});
