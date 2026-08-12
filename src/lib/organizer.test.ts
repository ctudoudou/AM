import fs from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { matchMetadataForGroup } from "@/lib/metadata";
import { getAppSettings } from "@/lib/settings";
import {
  assessOrganizerPlanAutomation,
  applyOrganizerAiReview,
  buildOrganizerExtraTargetPath,
  buildOrganizerEpisodeTitleSegment,
  classifyOrganizerFile,
  cleanupPollutedOrganizerPlans,
  createOrganizerPlanForCandidateSource,
  executeOrganizerPlan,
  hasBlockingOrganizerPlan,
  hasUnresolvedOrganizerReviewPlan,
  inspectCompletedDownloads,
  isAutoExecutableOrganizerPlan,
  organizerTargetPathLooksPolluted,
  OrganizerAiReviewError,
  OrganizerExecutionBusyError,
  OrganizerPlanStaleError,
  regenerateRejectedOrganizerPlan,
  reviewOrganizerPlanWithAi,
  resolveOrganizerItemIdentity,
  resolveOrganizerMediaType,
} from "./organizer";

vi.mock("node:fs/promises", () => ({
  default: {
    access: vi.fn(),
    mkdir: vi.fn(),
    readdir: vi.fn(),
    rename: vi.fn(),
    stat: vi.fn(),
  },
}));

vi.mock("@/lib/metadata", () => ({
  matchMetadataForGroup: vi.fn(),
}));

vi.mock("@/lib/settings", () => ({
  getAppSettings: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    download: {
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    releaseCandidate: {
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    organizerPlan: {
      create: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    organizerPlanItem: {
      deleteMany: vi.fn(),
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAppSettings).mockResolvedValue({
    directories: {
      dataRoot: "/data",
      downloadsDir: "/data/downloads",
      stagingDir: "/data/staging",
      animeLibraryDir: "/data/library/anime",
      moviesLibraryDir: "/data/library/movies",
      tvLibraryDir: "/data/library/tv",
      metadataDir: "/data/metadata",
      transcodesDir: "/data/transcodes",
    },
  } as never);
  vi.mocked(matchMetadataForGroup).mockResolvedValue({
    provider: "kitsu",
    externalId: "49372",
    title: "Seihantai na Kimi to Boku",
    originalTitle: "正反対な君と僕",
    year: 2026,
    score: 0.95,
    relevance: 1,
  } as never);
  vi.mocked(fs.stat).mockResolvedValue({ size: 100 } as never);
  vi.mocked(fs.access).mockRejectedValue(new Error("missing") as never);
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

  it("prefers distinct source episodes for a multi-file batch with a stale candidate episode", () => {
    const identity = resolveOrganizerItemIdentity({
      sourcePath: "/data/downloads/Dagashi Kashi 2018 S02E12 BDRip 1080p AV1 OPUS.mkv",
      preferSourceEpisode: true,
      candidate: {
        mediaType: "ANIME",
        parsedTitle: "Dagashi Kashi",
        normalizedTitle: "dagashi kashi",
        episodeNumber: 2,
        season: 2,
        group: {
          displayTitle: "Dagashi Kashi",
          normalizedTitle: "dagashi kashi",
          aliases: [],
        },
      },
    });

    expect(identity.season).toBe(2);
    expect(identity.episodeNumber).toBe(12);
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

describe("applyOrganizerAiReview", () => {
  const items = [
    { id: "item-1", sourcePath: "/data/downloads/episode-01.mkv", fileType: "video" },
    { id: "item-2", sourcePath: "/data/downloads/episode-02.mkv", fileType: "video" },
  ];

  beforeEach(() => {
    vi.mocked(prisma.organizerPlan.findUnique).mockResolvedValue({ metadata: null } as never);
    vi.mocked(prisma.organizerPlan.update).mockResolvedValue({ id: "plan-1" } as never);
    vi.mocked(prisma.organizerPlanItem.deleteMany).mockResolvedValue({ count: 0 } as never);
  });

  it("accepts only a complete high-confidence AI classification as safe", async () => {
    const result = await applyOrganizerAiReview(
      "plan-1",
      {
        riskLevel: "OK",
        confidence: 0.94,
        summary: "Both episodes match the title.",
        acceptedSourcePaths: items.map((item) => item.sourcePath),
        rejectedSourcePaths: [],
      },
      items,
    );

    expect(result).toMatchObject({
      acceptedItems: 2,
      filteredItems: 0,
      flagged: false,
      unclassifiedItems: 0,
    });
    expect(prisma.organizerPlan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: undefined }),
      }),
    );
  });

  it("keeps incomplete AI classifications in manual review", async () => {
    const result = await applyOrganizerAiReview(
      "plan-1",
      {
        riskLevel: "OK",
        confidence: 0.95,
        summary: "One episode was classified.",
        acceptedSourcePaths: [items[0].sourcePath],
        rejectedSourcePaths: [],
      },
      items,
    );

    expect(result).toMatchObject({ flagged: true, unclassifiedItems: 1 });
    expect(prisma.organizerPlan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "NEEDS_REVIEW" }),
      }),
    );
  });

  it("stores structured role changes as suggestions without deleting plan items", async () => {
    const result = await applyOrganizerAiReview(
      "plan-1",
      {
        riskLevel: "REVIEW",
        confidence: 0.91,
        summary: "The second file is an extra.",
        acceptedSourcePaths: items.map((item) => item.sourcePath),
        rejectedSourcePaths: [],
        fileClassifications: [
          {
            sourcePath: items[0].sourcePath,
            role: "MAIN_VIDEO",
            mediaType: "ANIME",
            title: "Example",
            season: 1,
            episodeNumber: 1,
            confidence: 0.94,
            evidence: "S01E01",
          },
          {
            sourcePath: items[1].sourcePath,
            role: "EXTRA_VIDEO",
            mediaType: "ANIME",
            title: "Example",
            season: 1,
            episodeNumber: null,
            confidence: 0.9,
            evidence: "Preview marker",
          },
        ],
      },
      items,
    );

    expect(result).toMatchObject({ filteredItems: 0, suggestedChanges: 1, flagged: true });
    expect(prisma.organizerPlanItem.deleteMany).not.toHaveBeenCalled();
  });
});

describe("reviewOrganizerPlanWithAi", () => {
  it("rejects oversized packages before calling the AI provider", async () => {
    vi.mocked(prisma.organizerPlan.findUniqueOrThrow).mockResolvedValueOnce({
      id: "plan-large",
      status: "NEEDS_REVIEW",
      items: Array.from({ length: 61 }, (_, index) => ({
        id: `item-${index}`,
        sourcePath: `/data/downloads/file-${index}.mkv`,
        targetPath: `/data/library/anime/Title/file-${index}.mkv`,
      })),
      candidate: { group: null },
    } as never);

    await expect(reviewOrganizerPlanWithAi("plan-large")).rejects.toMatchObject<
      Partial<OrganizerAiReviewError>
    >({
      code: "ORGANIZER_AI_REVIEW_TOO_LARGE",
    });
    expect(prisma.organizerPlan.update).not.toHaveBeenCalled();
  });
});

describe("createOrganizerPlanForCandidateSource", () => {
  it("replans a stale Dagashi Kashi batch candidate into distinct season-two episodes", async () => {
    const sourcePaths = [1, 2, 12].map(
      (episode) =>
        `/data/downloads/[BDrip] Dagashi Kashi S02 [ktnbytes]/Dagashi Kashi 2018 S02E${String(episode).padStart(2, "0")}-[1080p][BDRIP][AV1.OPUS].mkv`,
    );
    vi.mocked(prisma.releaseCandidate.findUniqueOrThrow).mockResolvedValueOnce(
      organizerReleaseCandidate({
        rawTitle:
          "[7³ACG] 粗点心战争 第2季/Dagashi Kashi S02 | 01-12 [简繁字幕] BDrip 1080p AV1 OPUS 2.0",
        parsedTitle: "粗点心战争 第2季 Dagashi Kashi S02 01-12",
        normalizedTitle: "粗点心战争 dagashi kashi 01 12",
        episodeNumber: 2,
      }) as never,
    );
    vi.mocked(prisma.releaseCandidate.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(matchMetadataForGroup).mockResolvedValueOnce({
      provider: "fallback",
      externalId: "",
      title: "粗点心战争 第2季 Dagashi Kashi S02 01-12",
      score: 0.55,
      relevance: 0.5,
    } as never);
    vi.mocked(prisma.organizerPlan.create).mockResolvedValueOnce({ id: "plan-1" } as never);

    await createOrganizerPlanForCandidateSource({
      candidateId: "candidate-1",
      downloadId: "download-1",
      sourceRoot: sourcePaths[0],
      sourcePaths,
    });

    const createArgs = vi.mocked(prisma.organizerPlan.create).mock.calls[0]?.[0] as {
      data: {
        status: string;
        items: { create: Array<{ targetPath: string; conflict: boolean }> };
      };
    };
    const targets = createArgs.data.items.create.map((item) => item.targetPath);

    expect(targets).toHaveLength(3);
    expect(targets.some((target) => target.includes("S02E01"))).toBe(true);
    expect(targets.some((target) => target.includes("S02E02"))).toBe(true);
    expect(targets.some((target) => target.includes("S02E12"))).toBe(true);
    expect(new Set(targets)).toHaveLength(3);
    expect(targets.every((target) => !target.includes("01-12"))).toBe(true);
    expect(createArgs.data.items.create.every((item) => !item.conflict)).toBe(true);
    expect(createArgs.data.status).not.toBe("CONFLICT");
  });

  it("archives every matching numbered video in an anime batch as an episode", async () => {
    const sourcePaths = [
      "/data/downloads/[SweetSub] Seihantai na Kimi to Boku [01-03][WebRip][1080P][AVC 8bit][CHS]/[SweetSub] Seihantai na Kimi to Boku - 01 [WebRip][1080P][AVC 8bit][CHS].mp4",
      "/data/downloads/[SweetSub] Seihantai na Kimi to Boku [01-03][WebRip][1080P][AVC 8bit][CHS]/[SweetSub] Seihantai na Kimi to Boku - 02 [WebRip][1080P][AVC 8bit][CHS].mp4",
      "/data/downloads/[SweetSub] Seihantai na Kimi to Boku [01-03][WebRip][1080P][AVC 8bit][CHS]/[SweetSub] Seihantai na Kimi to Boku - 03 [WebRip][1080P][AVC 8bit][CHS].mp4",
    ];
    vi.mocked(prisma.releaseCandidate.findUniqueOrThrow).mockResolvedValueOnce(
      organizerReleaseCandidate({
        rawTitle:
          "[SweetSub][正相反的你与我][Seihantai na Kimi to Boku][01-03][WebRip][1080P][AVC 8bit][CHS]",
        parsedTitle: "正相反的你与我 / Seihantai na Kimi to Boku",
        normalizedTitle: "正相反的你与我",
        episodeNumber: null,
      }) as never,
    );
    vi.mocked(prisma.releaseCandidate.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.organizerPlan.create).mockResolvedValueOnce({ id: "plan-1" } as never);

    await createOrganizerPlanForCandidateSource({
      candidateId: "candidate-1",
      downloadId: "download-1",
      sourceRoot: sourcePaths[1],
      sourcePaths,
    });

    const createArgs = vi.mocked(prisma.organizerPlan.create).mock.calls[0]?.[0] as {
      data: { items: { create: Array<{ fileType: string; targetPath: string; conflict: boolean }> } };
    };
    const items = createArgs.data.items.create;

    expect(items).toHaveLength(3);
    expect(items.map((item) => item.fileType)).toEqual(["video", "video", "video"]);
    expect(items.map((item) => item.targetPath)).toEqual(
      expect.arrayContaining([
        "/data/library/anime/Seihantai na Kimi to Boku (2026)/Season 01/Seihantai na Kimi to Boku - S01E01 [SweetSub][1080P][AVC].mp4",
        "/data/library/anime/Seihantai na Kimi to Boku (2026)/Season 01/Seihantai na Kimi to Boku - S01E02 [SweetSub][1080P][AVC].mp4",
        "/data/library/anime/Seihantai na Kimi to Boku (2026)/Season 01/Seihantai na Kimi to Boku - S01E03 [SweetSub][1080P][AVC].mp4",
      ]),
    );
    expect(items.some((item) => item.targetPath.includes("/Extras/"))).toBe(false);
    expect(items.some((item) => item.conflict)).toBe(false);
  });

  it("keeps unrelated videos in a package as extras", async () => {
    const sourcePaths = [
      "/data/downloads/Mixed Pack/[SweetSub] Seihantai na Kimi to Boku - 01 [WebRip][1080P][AVC 8bit][CHS].mp4",
      "/data/downloads/Mixed Pack/Other Anime - 01 [1080P][AVC].mp4",
    ];
    vi.mocked(prisma.releaseCandidate.findUniqueOrThrow).mockResolvedValueOnce(
      organizerReleaseCandidate({
        rawTitle: "[SweetSub][正相反的你与我][Seihantai na Kimi to Boku][01][WebRip][1080P][AVC 8bit][CHS]",
        parsedTitle: "正相反的你与我 / Seihantai na Kimi to Boku",
        normalizedTitle: "正相反的你与我",
        episodeNumber: null,
      }) as never,
    );
    vi.mocked(prisma.releaseCandidate.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.organizerPlan.create).mockResolvedValueOnce({ id: "plan-1" } as never);

    await createOrganizerPlanForCandidateSource({
      candidateId: "candidate-1",
      downloadId: "download-1",
      sourceRoot: sourcePaths[0],
      sourcePaths,
    });

    const createArgs = vi.mocked(prisma.organizerPlan.create).mock.calls[0]?.[0] as {
      data: { items: { create: Array<{ originalName: string; fileType: string; targetPath: string }> } };
    };
    const unrelated = createArgs.data.items.create.find((item) => item.originalName.startsWith("Other Anime"));

    expect(unrelated?.fileType).toBe("extra_video");
    expect(unrelated?.targetPath).toContain("/Extras/");
  });

  it("marks duplicate episode targets inside the same package as conflicts", async () => {
    const sourcePaths = [
      "/data/downloads/Duplicate Pack/[SweetSub] Seihantai na Kimi to Boku - 01 [WebRip][1080P][AVC 8bit][CHS].mp4",
      "/data/downloads/Duplicate Pack/[SweetSub] Seihantai na Kimi to Boku - 01v2 [WebRip][1080P][AVC 8bit][CHS].mp4",
    ];
    vi.mocked(prisma.releaseCandidate.findUniqueOrThrow).mockResolvedValueOnce(
      organizerReleaseCandidate({
        rawTitle: "[SweetSub][正相反的你与我][Seihantai na Kimi to Boku][01][WebRip][1080P][AVC 8bit][CHS]",
        parsedTitle: "正相反的你与我 / Seihantai na Kimi to Boku",
        normalizedTitle: "正相反的你与我",
        episodeNumber: null,
      }) as never,
    );
    vi.mocked(prisma.releaseCandidate.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.organizerPlan.create).mockResolvedValueOnce({ id: "plan-1" } as never);

    await createOrganizerPlanForCandidateSource({
      candidateId: "candidate-1",
      downloadId: "download-1",
      sourceRoot: sourcePaths[0],
      sourcePaths,
    });

    const createArgs = vi.mocked(prisma.organizerPlan.create).mock.calls[0]?.[0] as {
      data: {
        status: string;
        reason: string;
        items: { create: Array<{ conflict: boolean; conflictReason?: string | null }> };
      };
    };

    expect(createArgs.data.status).toBe("CONFLICT");
    expect(createArgs.data.reason).toBe("Target path conflict");
    expect(createArgs.data.items.create.every((item) => item.conflict)).toBe(true);
    expect(createArgs.data.items.create[0].conflictReason).toBe("Duplicate target path in organizer plan");
  });
});

describe("cleanupPollutedOrganizerPlans", () => {
  it("removes legacy batch plans that placed episode videos under Extras", async () => {
    vi.mocked(prisma.organizerPlan.findMany).mockResolvedValueOnce([
      {
        id: "plan-1",
        downloadId: "download-1",
        items: [
          {
            sourcePath:
              "/data/downloads/[SweetSub] Seihantai na Kimi to Boku [01-03]/[SweetSub] Seihantai na Kimi to Boku - 01 [WebRip][1080P][AVC 8bit][CHS].mp4",
            targetPath:
              "/data/library/anime/Seihantai na Kimi to Boku (2026)/Season 01/Extras/[SweetSub] Seihantai na Kimi to Boku - 01 [WebRip][1080P][AVC 8bit][CHS].mp4",
            fileType: "extra_video",
          },
        ],
        candidate: organizerReleaseCandidate({
          rawTitle:
            "[SweetSub][正相反的你与我][Seihantai na Kimi to Boku][01-03][WebRip][1080P][AVC 8bit][CHS]",
          parsedTitle: "正相反的你与我 / Seihantai na Kimi to Boku",
          normalizedTitle: "正相反的你与我",
          episodeNumber: null,
        }),
      },
    ] as never);
    vi.mocked(prisma.organizerPlan.delete).mockResolvedValueOnce({ id: "plan-1" } as never);
    vi.mocked(prisma.download.updateMany).mockResolvedValueOnce({ count: 1 } as never);

    await expect(cleanupPollutedOrganizerPlans()).resolves.toMatchObject({
      inspected: 1,
      deleted: 1,
      plans: ["plan-1"],
    });
    expect(prisma.organizerPlan.delete).toHaveBeenCalledWith({ where: { id: "plan-1" } });
    expect(prisma.download.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["download-1"] } },
      data: { archiveStatus: null },
    });
  });
});

describe("classifyOrganizerFile", () => {
  it("classifies playable videos and common extra assets", () => {
    expect(classifyOrganizerFile("/downloads/movie.mkv")).toBe("video");
    expect(classifyOrganizerFile("/downloads/Extra/OP.flac")).toBe("audio");
    expect(classifyOrganizerFile("/downloads/Extra/Scans/booklet.avif")).toBe("image");
    expect(classifyOrganizerFile("/downloads/Extra/CD1/soundtrack.cue")).toBe("metadata");
    expect(classifyOrganizerFile("/downloads/Extra/README.md")).toBeNull();
  });
});

describe("buildOrganizerExtraTargetPath", () => {
  it("places movie package extras under the movie Extras directory", () => {
    expect(
      buildOrganizerExtraTargetPath({
        mediaType: "MOVIE",
        roots: {
          animeLibraryDir: "/data/library/anime",
          moviesLibraryDir: "/data/library/movies",
          tvLibraryDir: "/data/library/tv",
        },
        title: "佐贺偶像是传奇 梦想银河乐园",
        season: 1,
        sourcePackageRoot:
          "/data/downloads/[H-Enc] Zombie Land Saga Yumeginga Paradise (BDRip 1080p HEVC FLAC)",
        sourcePath:
          "/data/downloads/[H-Enc] Zombie Land Saga Yumeginga Paradise (BDRip 1080p HEVC FLAC)/Extra/CD1/01. 空飛ぶ首.flac",
      }),
    ).toBe("/data/library/movies/佐贺偶像是传奇 梦想银河乐园/Extras/CD1/01. 空飛ぶ首.flac");
  });

  it("preserves scan subdirectories without duplicating the Extra segment", () => {
    expect(
      buildOrganizerExtraTargetPath({
        mediaType: "MOVIE",
        roots: {
          animeLibraryDir: "/data/library/anime",
          moviesLibraryDir: "/data/library/movies",
          tvLibraryDir: "/data/library/tv",
        },
        title: "Zombie Land Saga Yumeginga Paradise",
        season: 1,
        sourcePackageRoot: "/data/downloads/ZLS",
        sourcePath: "/data/downloads/ZLS/Extra/Scans/Booklet 01.avif",
      }),
    ).toBe("/data/library/movies/Zombie Land Saga Yumeginga Paradise/Extras/Scans/Booklet 01.avif");
  });

  it("truncates long UTF-8 names without dropping the extension", () => {
    const target = buildOrganizerExtraTargetPath({
      mediaType: "ANIME",
      roots: {
        animeLibraryDir: "/data/library/anime",
        moviesLibraryDir: "/data/library/movies",
        tvLibraryDir: "/data/library/tv",
      },
      title: "Some Anime",
      season: 1,
      sourcePackageRoot: "/data/downloads/Some Anime",
      sourcePath: `/data/downloads/Some Anime/Extra/${"很长的特典文件名".repeat(40)}.mkv`,
    });
    const filename = target.split("/").at(-1) ?? "";

    expect(filename.endsWith(".mkv")).toBe(true);
    expect(Buffer.byteLength(filename)).toBeLessThanOrEqual(240);
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

  it("flags unresolved S00E00 target paths from polluted import plans", () => {
    expect(
      organizerTargetPathLooksPolluted(
        "/data/library/anime/國╱日/Season 01/國╱日 - S00E00 [國╱日][1080p][H265].mkv",
      ),
    ).toBe(true);
  });

  it("flags language-only series directories even when an episode code is present", () => {
    expect(
      organizerTargetPathLooksPolluted(
        "/data/library/anime/國╱日/Season 01/國╱日 - S01E07 [1080p][H265].mkv",
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

  it("treats one unresolved empty review as outstanding without changing regeneration blocking", () => {
    expect(
      hasUnresolvedOrganizerReviewPlan([
        { status: "NEEDS_REVIEW", resolvedAt: null },
      ]),
    ).toBe(true);
    expect(
      hasUnresolvedOrganizerReviewPlan([
        { status: "NEEDS_REVIEW", resolvedAt: new Date() },
      ]),
    ).toBe(false);
  });
});

describe("inspectCompletedDownloads", () => {
  it("records one failed organizer plan without blocking later completed downloads", async () => {
    vi.mocked(prisma.download.findMany).mockResolvedValueOnce([
      {
        id: "missing-download",
        candidateId: "candidate-1",
        sourceUrl: "magnet:?xt=urn:btih:missing",
        targetPath: "/data/downloads/Missing Episode.mkv",
        archiveStatus: "organizer_failed",
        candidate: { mediaType: "ANIME" },
        organizerPlans: [],
      },
      {
        id: "next-download",
        candidateId: "candidate-2",
        sourceUrl: "magnet:?xt=urn:btih:next",
        targetPath: null,
        archiveStatus: "organizer_failed",
        candidate: { mediaType: "ANIME" },
        organizerPlans: [],
      },
    ] as never);
    vi.mocked(prisma.download.findUniqueOrThrow)
      .mockResolvedValueOnce({
        id: "missing-download",
        candidateId: "candidate-1",
        targetPath: "/data/downloads/Missing Episode.mkv",
        candidate: organizerReleaseCandidate({
          id: "candidate-1",
          parsedTitle: "Missing Episode",
          rawTitle: "Missing Episode - 01",
        }),
      } as never)
      .mockResolvedValueOnce({
        id: "next-download",
        candidateId: "candidate-2",
        targetPath: null,
        candidate: organizerReleaseCandidate({
          id: "candidate-2",
          parsedTitle: "Seihantai na Kimi to Boku",
          rawTitle: "[SweetSub] Seihantai na Kimi to Boku - 02 [1080P].mp4",
        }),
      } as never);
    vi.mocked(prisma.releaseCandidate.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(fs.stat).mockRejectedValueOnce(new Error("ENOENT: no such file or directory"));
    vi.mocked(prisma.organizerPlan.create)
      .mockResolvedValueOnce({ id: "failed-plan" } as never)
      .mockResolvedValueOnce({ id: "next-plan" } as never);
    vi.mocked(prisma.download.update).mockResolvedValueOnce({ id: "missing-download" } as never);

    await expect(inspectCompletedDownloads()).resolves.toMatchObject({
      inspected: 1,
      failed: 1,
      plans: ["next-plan"],
      failures: [{ downloadId: "missing-download", planId: "failed-plan" }],
    });
    expect(prisma.download.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "COMPLETED",
          supersededById: null,
          OR: expect.arrayContaining([{ archiveStatus: null }]),
        }),
        orderBy: { createdAt: "asc" },
      }),
    );
    expect(prisma.organizerPlan.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        downloadId: "missing-download",
        candidateId: "candidate-1",
        status: "FAILED",
        items: expect.any(Object),
      }),
    });
    expect(prisma.download.update).toHaveBeenCalledWith({
      where: { id: "missing-download" },
      data: expect.objectContaining({ archiveStatus: "organizer_failed" }),
    });
    expect(prisma.organizerPlan.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        downloadId: "next-download",
        candidateId: "candidate-2",
        status: "NEEDS_REVIEW",
      }),
    });
  });

  it("skips null-state completed duplicates when the same source is already archived", async () => {
    vi.mocked(prisma.download.findMany)
      .mockResolvedValueOnce([
        {
          id: "duplicate-download",
          candidateId: "candidate-1",
          sourceUrl: "magnet:?xt=urn:btih:duplicate",
          targetPath: "/data/downloads/Recreated Episode.mkv",
          archiveStatus: null,
          candidate: { mediaType: "ANIME" },
          organizerPlans: [],
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          id: "archived-download",
          sourceUrl: "magnet:?xt=urn:btih:duplicate",
        },
      ] as never);

    await expect(inspectCompletedDownloads()).resolves.toMatchObject({
      inspected: 0,
      failed: 0,
      skipped: 1,
      skippedDownloads: [
        {
          downloadId: "duplicate-download",
          canonicalDownloadId: "archived-download",
          reason: "completed_source_already_archived",
        },
      ],
    });
    expect(prisma.organizerPlan.create).not.toHaveBeenCalled();
  });

  it("reports null-state completed records with missing sources without creating failed plans", async () => {
    vi.mocked(prisma.download.findMany)
      .mockResolvedValueOnce([
        {
          id: "missing-source",
          candidateId: "candidate-1",
          sourceUrl: "magnet:?xt=urn:btih:missing-source",
          targetPath: "/data/downloads/Gone Episode.mkv",
          archiveStatus: null,
          candidate: { mediaType: "ANIME" },
          organizerPlans: [],
        },
      ] as never)
      .mockResolvedValueOnce([] as never);
    vi.mocked(fs.stat).mockRejectedValueOnce(new Error("ENOENT"));

    await expect(inspectCompletedDownloads()).resolves.toMatchObject({
      inspected: 0,
      failed: 0,
      skipped: 1,
      skippedDownloads: [
        {
          downloadId: "missing-source",
          reason: "completed_source_missing",
        },
      ],
    });
    expect(prisma.organizerPlan.create).not.toHaveBeenCalled();
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

  it("creates a valid replacement before removing the rejected plan", async () => {
    vi.mocked(fs.stat).mockReset();
    vi.mocked(fs.stat).mockResolvedValue({ size: 100, isFile: () => true } as never);
    const newPlan = { id: "plan-2", status: "NEEDS_REVIEW", items: [] };
    vi.mocked(prisma.organizerPlan.findUniqueOrThrow).mockResolvedValueOnce({
      id: "plan-1",
      status: "REJECTED",
      downloadId: "download-1",
      download: { archiveStatus: "organizer_failed" },
      items: [{ sourcePath: "/data/downloads/episode.mkv" }],
    } as never);
    vi.mocked(fs.access).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.organizerPlan.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.download.findUniqueOrThrow).mockResolvedValueOnce({
      id: "download-1",
      candidateId: null,
      candidate: {
        id: "candidate-1",
        groupId: "group-1",
        mediaType: "ANIME",
        group: { id: "group-1" },
      },
      targetPath: "/data/downloads/episode.mkv",
      aria2Files: [
        { path: "[METADATA]08a536f95860edf4a351aeee82411c8d290a3efc", selected: "true" },
        { path: "/data/downloads/episode.mkv", selected: "true" },
      ],
    } as never);
    vi.mocked(prisma.releaseCandidate.findUniqueOrThrow).mockResolvedValueOnce({
      id: "candidate-1",
      groupId: "group-1",
      mediaType: "ANIME",
      parsedTitle: "Episode",
      normalizedTitle: "episode",
      episodeNumber: 1,
      season: 1,
      group: { displayTitle: "Episode", normalizedTitle: "episode", aliases: [] },
    } as never);
    vi.mocked(prisma.releaseCandidate.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.organizerPlan.create).mockResolvedValueOnce(newPlan as never);
    vi.mocked(prisma.organizerPlan.findUniqueOrThrow).mockResolvedValueOnce({
      items: [{ id: "replacement-item" }],
    } as never);
    vi.mocked(prisma.organizerPlan.delete).mockResolvedValueOnce({ id: "plan-1" } as never);

    await expect(regenerateRejectedOrganizerPlan("plan-1")).resolves.toBe(newPlan);
    expect(prisma.organizerPlan.update).toHaveBeenCalledWith({
      where: { id: "plan-1" },
      data: {
        resolvedAt: expect.any(Date),
        resolution: "Regenerated as organizer plan plan-2.",
      },
    });
    expect(prisma.organizerPlan.delete).not.toHaveBeenCalled();
  });

  it("keeps the rejected plan when its source file is missing", async () => {
    vi.mocked(fs.access).mockReset();
    vi.mocked(fs.access).mockRejectedValue(new Error("missing"));
    vi.mocked(prisma.organizerPlan.findUniqueOrThrow).mockResolvedValueOnce({
      id: "plan-1",
      status: "REJECTED",
      downloadId: "download-1",
      download: { archiveStatus: "organizer_failed" },
      items: [{ sourcePath: "/data/downloads/missing.mkv" }],
    } as never);
    vi.mocked(prisma.organizerPlan.findMany).mockResolvedValueOnce([] as never);
    await expect(regenerateRejectedOrganizerPlan("plan-1")).rejects.toThrow(
      "Rejected organizer plan source files are missing.",
    );
    expect(prisma.organizerPlan.delete).not.toHaveBeenCalled();
    expect(prisma.download.update).not.toHaveBeenCalled();
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
      mediaType: "ANIME",
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

  it("blocks polluted import targets that would archive to S00E00", () => {
    const assessment = assessOrganizerPlanAutomation({
      mediaType: "ANIME",
      status: "NEEDS_REVIEW",
      confidence: 0.55,
      autoExecutable: false,
      candidate: {
        mediaType: "ANIME",
        parsedTitle: "國╱日",
        normalizedTitle: "国╱日",
        group: {
          displayTitle: "國╱日",
          normalizedTitle: "国╱日",
          aliases: ["国╱日"],
        },
      },
      items: [
        {
          sourcePath: "/data/import/龍王的工作/龍王的工作 #7 [國╱日] (TVRip 1920x1080 H265 AAC).mkv",
          targetPath: "/data/library/anime/國╱日/Season 01/國╱日 - S00E00 [國╱日][1080p][H265].mkv",
          fileType: "video",
          conflict: false,
        },
      ],
    });

    expect(assessment.executable).toBe(false);
    expect(assessment.autoExecutable).toBe(false);
    expect(assessment.reasons).toContain("Plan has a polluted target path.");
    expect(assessment.reasons).toContain("Plan has unresolved episode identity.");
  });

  it("does not require episode identity for movie targets", () => {
    const assessment = assessOrganizerPlanAutomation({
      mediaType: "MOVIE",
      status: "PENDING",
      confidence: 0.95,
      autoExecutable: true,
      candidate: {
        mediaType: "MOVIE",
        parsedTitle: "Some Movie",
        normalizedTitle: "some movie",
        group: null,
      },
      items: [
        {
          sourcePath: "/data/downloads/Some Movie.mkv",
          targetPath: "/data/library/movies/Some Movie/Some Movie.mkv",
          fileType: "video",
          conflict: false,
        },
      ],
    });

    expect(assessment.executable).toBe(true);
  });

  it("blocks episode videos routed to Extras and extension-changing targets", () => {
    const assessment = assessOrganizerPlanAutomation({
      mediaType: "ANIME",
      status: "PENDING",
      confidence: 0.95,
      autoExecutable: true,
      candidate: organizerCandidate(),
      items: [
        {
          sourcePath: "/data/downloads/Some Anime - 05.mkv",
          targetPath: "/data/library/anime/Some Anime/Season 01/Extras/Some Anime - 05.mp4",
          fileType: "extra_video",
          conflict: false,
        },
      ],
    });

    expect(assessment.executable).toBe(false);
    expect(assessment.reasons).toContain("Plan puts an episode video under Extras.");
    expect(assessment.reasons).toContain(
      "A target filename does not preserve the source extension.",
    );
  });
});

describe("executeOrganizerPlan concurrency guards", () => {
  const plan = {
    id: "plan-1",
    mediaType: "ANIME" as const,
    status: "PENDING" as const,
    confidence: 0.95,
    autoExecutable: false,
    reason: "Ready for confirmation",
    updatedAt: new Date("2026-07-28T12:00:00.000Z"),
    downloadId: null,
    download: null,
    candidate: organizerCandidate(),
    items: [
      {
        id: "item-1",
        sourcePath: "/data/downloads/Some Anime - 01.mkv",
        targetPath: "/data/library/anime/Some Anime/Season 01/Some Anime - S01E01.mkv",
        fileType: "video",
        conflict: false,
        conflictReason: null,
      },
    ],
  };

  it("rejects a plan changed after the review dialog opened", async () => {
    vi.mocked(prisma.organizerPlan.findUniqueOrThrow).mockResolvedValueOnce(plan as never);

    await expect(
      executeOrganizerPlan("plan-1", false, "a".repeat(64)),
    ).rejects.toBeInstanceOf(OrganizerPlanStaleError);
    expect(prisma.organizerPlan.updateMany).not.toHaveBeenCalled();
  });

  it("allows only one caller to acquire the execution lease", async () => {
    vi.mocked(prisma.organizerPlan.findUniqueOrThrow).mockResolvedValueOnce(plan as never);
    vi.mocked(fs.access)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("ENOENT"));
    vi.mocked(prisma.organizerPlan.updateMany).mockResolvedValueOnce({ count: 0 } as never);
    const { createOrganizerPlanVersion } = await import("./organizer-plan-version");

    await expect(
      executeOrganizerPlan("plan-1", false, createOrganizerPlanVersion(plan)),
    ).rejects.toBeInstanceOf(OrganizerExecutionBusyError);
    expect(prisma.organizerPlan.updateMany).toHaveBeenCalledWith({
      where: {
        id: "plan-1",
        status: "PENDING",
        updatedAt: plan.updatedAt,
      },
      data: {
        status: "EXECUTING",
        reason: "Organizer execution in progress.",
      },
    });
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

function organizerReleaseCandidate(input: {
  rawTitle: string;
  parsedTitle: string;
  normalizedTitle: string;
  episodeNumber: number | null;
}) {
  return {
    id: "candidate-1",
    groupId: "group-1",
    rssItemId: "rss-1",
    mediaType: "ANIME" as const,
    rawTitle: input.rawTitle,
    parsedTitle: input.parsedTitle,
    normalizedTitle: input.normalizedTitle,
    subtitleGroup: "SweetSub",
    episodeNumber: input.episodeNumber,
    season: null,
    resolution: "1080P",
    codec: "AVC",
    audio: null,
    subtitleLanguage: "CHS",
    releaseProfile: "WEBRip / CHS",
    sourceKind: "WEBRip",
    variantKey: "sweetsub|webrip|chs|1080p|avc",
    releaseTags: ["SweetSub", "01-03", "WebRip", "1080P", "AVC 8bit", "CHS"],
    episodeIdentity: null,
    magnetUrl: null,
    torrentUrl: null,
    torrentFilePath: null,
    sourceUrl: "magnet:?xt=urn:btih:test",
    confidence: 0.8,
    status: "DOWNLOADED",
    createdAt: new Date("2026-07-07T00:00:00.000Z"),
    updatedAt: new Date("2026-07-07T00:00:00.000Z"),
    group: {
      id: "group-1",
      mediaType: "ANIME" as const,
      normalizedTitle: input.normalizedTitle,
      displayTitle: input.parsedTitle,
      season: 1,
      confidence: 0.85,
      reviewRequired: false,
      aiSummary: "Test group",
      aliases: [
        input.parsedTitle,
        "Seihantai na Kimi to Boku",
        "正相反的你与我",
      ],
      createdAt: new Date("2026-07-07T00:00:00.000Z"),
      updatedAt: new Date("2026-07-07T00:00:00.000Z"),
    },
  };
}
