import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  assessOrganizerPlanAutomation,
  buildOrganizerEpisodeTitleSegment,
  hasBlockingOrganizerPlan,
  isAutoExecutableOrganizerPlan,
  organizerTargetPathLooksPolluted,
  regenerateRejectedOrganizerPlan,
  resolveOrganizerItemIdentity,
  resolveOrganizerMediaType,
} from "./organizer";

vi.mock("@/lib/db", () => ({
  prisma: {
    download: {
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    organizerPlan: {
      create: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveOrganizerItemIdentity", () => {
  it("uses the actual file episode for downloaded batch releases", () => {
    const identity = resolveOrganizerItemIdentity({
      sourcePath:
        "/data/downloads/[Sakurato][202601] Arisugawa Ren tte Honto wa Onna Nanda yo ne. [01-08 Fin][1080P]/[Sakurato] Arisugawa Ren tte Honto wa Onna Nanda yo ne. [05][AVC-8bit 1080P AAC][CHT].mp4",
      candidate: {
        mediaType: "ANIME",
        parsedTitle: "有栖川炼原来是女孩子啊。 / Arisugawa Ren tte Honto wa Onna Nanda yo ne",
        normalizedTitle: "有栖川炼原来是女孩子啊",
        episodeNumber: null,
        season: null,
        group: {
          displayTitle: "有栖川炼原来是女孩子啊。 / Arisugawa Ren tte Honto wa Onna Nanda yo ne",
          normalizedTitle: "有栖川炼原来是女孩子啊",
          aliases: [
            "Arisugawa Ren tte Honto wa Onna Nanda yo ne",
            "有棲川煉原來是女孩子啊。",
          ],
        },
      },
    });

    expect(identity.season).toBe(1);
    expect(identity.episodeNumber).toBe(5);
    expect(identity.sourceParsedEpisode).toBe(5);
  });

  it("keeps explicit candidate episode identity when present", () => {
    const identity = resolveOrganizerItemIdentity({
      sourcePath: "/data/downloads/Some Anime - 05.mkv",
      candidate: {
        mediaType: "ANIME",
        parsedTitle: "Some Anime",
        normalizedTitle: "some anime",
        episodeNumber: 4,
        season: 2,
        group: {
          displayTitle: "Some Anime",
          normalizedTitle: "some anime",
          aliases: [],
        },
      },
    });

    expect(identity.season).toBe(2);
    expect(identity.episodeNumber).toBe(4);
  });
});

describe("buildOrganizerEpisodeTitleSegment", () => {
  it("drops episode titles that only repeat the series title", () => {
    expect(
      buildOrganizerEpisodeTitleSegment({
        title: "Some Anime",
        episodeTitle: "Some Anime",
        episodeCode: "S01E04",
      }),
    ).toBeNull();
  });

  it("drops noisy release-title fragments that only repeat known title aliases", () => {
    expect(
      buildOrganizerEpisodeTitleSegment({
        title: "Ichijyoma Mankitsu Gurashi!",
        titleAliases: ["一叠间漫画咖啡屋生活"],
        episodeTitle:
          "Ichijyoma Mankitsu Gurashi! - S01E06 - 一叠间漫画咖啡屋生活 - S01E06 - [三明治摆烂组][1080p][AVC]",
        episodeCode: "S01E06",
      }),
    ).toBeNull();
  });

  it("keeps real episode titles after removing release metadata", () => {
    expect(
      buildOrganizerEpisodeTitleSegment({
        title: "Some Anime",
        episodeTitle: "A New Day [1080p][AVC AAC].mkv",
        episodeCode: "S01E04",
      }),
    ).toBe("A New Day");
  });
});

describe("resolveOrganizerMediaType", () => {
  it("treats no-episode BD theatrical packages as movies", () => {
    expect(
      resolveOrganizerMediaType({
        sourceRoot:
          "/data/downloads/[H-Enc] Zombie Land Saga Yumeginga Paradise (BDRip 1080p HEVC FLAC)/Zombie Land Saga Yumeginga Paradise.mkv",
        files: [
          "/data/downloads/[H-Enc] Zombie Land Saga Yumeginga Paradise (BDRip 1080p HEVC FLAC)/Zombie Land Saga Yumeginga Paradise.mkv",
        ],
        candidate: {
          mediaType: "ANIME",
          parsedTitle: "佐贺偶像是传奇 梦想银河乐园",
          normalizedTitle: "佐贺偶像是传奇 梦想银河乐园",
          episodeNumber: 1,
          season: 1,
          group: null,
        },
      }),
    ).toBe("MOVIE");
  });

  it("keeps normal numbered anime releases as anime", () => {
    expect(
      resolveOrganizerMediaType({
        sourceRoot: "/data/downloads/Some Anime - 01 [BDRip 1080p].mkv",
        files: ["/data/downloads/Some Anime - 01 [BDRip 1080p].mkv"],
        candidate: {
          mediaType: "ANIME",
          parsedTitle: "Some Anime",
          normalizedTitle: "some anime",
          episodeNumber: 1,
          season: 1,
          group: null,
        },
      }),
    ).toBe("ANIME");
  });
});

describe("organizerTargetPathLooksPolluted", () => {
  it("flags target paths with duplicate episode codes in the file name", () => {
    expect(
      organizerTargetPathLooksPolluted(
        "/data/library/anime/Ichijyoma Mankitsu Gurashi!/Season 01/Ichijyoma Mankitsu Gurashi! - S01E06 - 一叠间漫画咖啡屋生活 - S01E06 [1080p].mkv",
      ),
    ).toBe(true);
  });

  it("allows normal target paths with one episode code", () => {
    expect(
      organizerTargetPathLooksPolluted(
        "/data/library/anime/Some Anime/Season 01/Some Anime - S01E06 [1080p].mkv",
      ),
    ).toBe(false);
  });
});

describe("hasBlockingOrganizerPlan", () => {
  it("ignores rejected plans but keeps executed and active plans blocking regeneration", () => {
    expect(
      hasBlockingOrganizerPlan([{ status: "REJECTED", items: [{ id: "item-1" }] }]),
    ).toBe(false);
    expect(
      hasBlockingOrganizerPlan([{ status: "EXECUTED", items: [{ id: "item-1" }] }]),
    ).toBe(true);
    expect(
      hasBlockingOrganizerPlan([{ status: "AUTO_ARCHIVED", items: [{ id: "item-1" }] }]),
    ).toBe(true);
    expect(
      hasBlockingOrganizerPlan([{ status: "NEEDS_REVIEW", items: [] }]),
    ).toBe(false);
    expect(
      hasBlockingOrganizerPlan([{ status: "PENDING", items: [{ id: "item-1" }] }]),
    ).toBe(true);
  });
});

describe("regenerateRejectedOrganizerPlan", () => {
  it("requires a rejected plan", async () => {
    vi.mocked(prisma.organizerPlan.findUniqueOrThrow).mockResolvedValueOnce({
      id: "plan-1",
      status: "PENDING",
      downloadId: "download-1",
    } as never);

    await expect(regenerateRejectedOrganizerPlan("plan-1")).rejects.toThrow(
      "Only rejected organizer plans can be regenerated.",
    );
    expect(prisma.download.update).not.toHaveBeenCalled();
    expect(prisma.organizerPlan.delete).not.toHaveBeenCalled();
    expect(prisma.organizerPlan.create).not.toHaveBeenCalled();
  });

  it("requires a linked download", async () => {
    vi.mocked(prisma.organizerPlan.findUniqueOrThrow).mockResolvedValueOnce({
      id: "plan-1",
      status: "REJECTED",
      downloadId: null,
    } as never);

    await expect(regenerateRejectedOrganizerPlan("plan-1")).rejects.toThrow(
      "Rejected organizer plan has no linked download.",
    );
    expect(prisma.download.update).not.toHaveBeenCalled();
    expect(prisma.organizerPlan.delete).not.toHaveBeenCalled();
    expect(prisma.organizerPlan.create).not.toHaveBeenCalled();
  });

  it("does not create a duplicate when the download already has a meaningful plan", async () => {
    vi.mocked(prisma.organizerPlan.findUniqueOrThrow).mockResolvedValueOnce({
      id: "plan-1",
      status: "REJECTED",
      downloadId: "download-1",
    } as never);
    vi.mocked(prisma.organizerPlan.findMany).mockResolvedValueOnce([
      { status: "AUTO_ARCHIVED", items: [{ id: "item-1" }] },
    ] as never);

    await expect(regenerateRejectedOrganizerPlan("plan-1")).rejects.toThrow(
      "Download already has an active or completed organizer plan.",
    );
    expect(prisma.download.update).not.toHaveBeenCalled();
    expect(prisma.organizerPlan.delete).not.toHaveBeenCalled();
    expect(prisma.organizerPlan.create).not.toHaveBeenCalled();
  });

  it("resets the download, removes the rejected plan, and creates a replacement", async () => {
    const newPlan = { id: "plan-2", status: "NEEDS_REVIEW", items: [] };
    vi.mocked(prisma.organizerPlan.findUniqueOrThrow).mockResolvedValueOnce({
      id: "plan-1",
      status: "REJECTED",
      downloadId: "download-1",
    } as never);
    vi.mocked(prisma.organizerPlan.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.download.update).mockResolvedValueOnce({ id: "download-1" } as never);
    vi.mocked(prisma.organizerPlan.delete).mockResolvedValueOnce({ id: "plan-1" } as never);
    vi.mocked(prisma.download.findUniqueOrThrow).mockResolvedValueOnce({
      id: "download-1",
      candidateId: null,
      candidate: null,
      targetPath: null,
    } as never);
    vi.mocked(prisma.organizerPlan.create).mockResolvedValueOnce(newPlan as never);

    await expect(regenerateRejectedOrganizerPlan("plan-1")).resolves.toBe(newPlan);
    expect(prisma.download.update).toHaveBeenCalledWith({
      where: { id: "download-1" },
      data: { archiveStatus: null },
    });
    expect(prisma.organizerPlan.delete).toHaveBeenCalledWith({
      where: { id: "plan-1" },
    });
    expect(prisma.organizerPlan.create).toHaveBeenCalledWith({
      data: {
        downloadId: "download-1",
        candidateId: null,
        mediaType: "ANIME",
        status: "NEEDS_REVIEW",
        confidence: 0,
        reason: "Download has no grouped candidate",
      },
    });
  });
});

describe("isAutoExecutableOrganizerPlan", () => {
  it("allows only high-confidence pending plans without conflicts", () => {
    expect(
      isAutoExecutableOrganizerPlan({
        status: "PENDING",
        confidence: 0.93,
        autoExecutable: true,
        candidate: organizerCandidate(),
        items: [{ sourcePath: "/data/downloads/Some Anime - 05.mkv", conflict: false }],
      }),
    ).toBe(true);

    expect(
      isAutoExecutableOrganizerPlan({
        status: "PENDING",
        confidence: 0.89,
        autoExecutable: true,
        candidate: organizerCandidate(),
        items: [{ sourcePath: "/data/downloads/Some Anime - 05.mkv", conflict: false }],
      }),
    ).toBe(false);
    expect(
      isAutoExecutableOrganizerPlan({
        status: "NEEDS_REVIEW",
        confidence: 0.96,
        autoExecutable: true,
        candidate: organizerCandidate(),
        items: [{ sourcePath: "/data/downloads/Some Anime - 05.mkv", conflict: false }],
      }),
    ).toBe(false);
    expect(
      isAutoExecutableOrganizerPlan({
        status: "PENDING",
        confidence: 0.96,
        autoExecutable: true,
        candidate: organizerCandidate(),
        items: [{ sourcePath: "/data/downloads/Some Anime - 05.mkv", conflict: true }],
      }),
    ).toBe(false);
  });
});

describe("assessOrganizerPlanAutomation", () => {
  it("explains why a legacy plan cannot be automatically archived", () => {
    const assessment = assessOrganizerPlanAutomation({
      status: "PENDING",
      confidence: 0.95,
      autoExecutable: false,
      candidate: organizerCandidate(),
      items: [{ sourcePath: "/data/downloads/Some Anime - 05.mkv", conflict: false }],
    });

    expect(assessment.executable).toBe(true);
    expect(assessment.autoExecutable).toBe(false);
    expect(assessment.reasons).toContain("Plan was not marked trusted when it was created.");
  });

  it("blocks execution when a source file is known missing", () => {
    const assessment = assessOrganizerPlanAutomation({
      status: "PENDING",
      confidence: 0.95,
      autoExecutable: true,
      candidate: organizerCandidate(),
      items: [
        {
          sourcePath: "/data/downloads/Some Anime - 05.mkv",
          conflict: false,
          sourceExists: false,
        },
      ],
    });

    expect(assessment.executable).toBe(false);
    expect(assessment.autoExecutable).toBe(false);
    expect(assessment.reasons).toContain("One or more source files are missing.");
  });
});

function organizerCandidate() {
  return {
    mediaType: "ANIME" as const,
    parsedTitle: "Some Anime",
    normalizedTitle: "some anime",
    group: {
      displayTitle: "Some Anime",
      normalizedTitle: "some anime",
      aliases: [],
    },
  };
}
