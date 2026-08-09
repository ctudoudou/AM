import fs from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { cacheRemoteMediaAsset } from "@/lib/media-assets";
import {
  addMediaTitleAliases,
  findExistingMediaTitle,
} from "@/lib/media-title-repair";
import {
  moveOrganizerFiles,
  rollbackOrganizerFiles,
} from "@/lib/organizer-lifecycle";
import { getAppSettings } from "@/lib/settings";
import { executeOrganizerPlan } from "./organizer";

vi.mock("node:fs/promises", () => ({
  default: {
    access: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: vi.fn(),
    download: { update: vi.fn() },
    episode: { upsert: vi.fn() },
    mediaFile: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    mediaTitle: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    operationLog: {
      create: vi.fn(),
      update: vi.fn(),
    },
    organizerPlan: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    season: { upsert: vi.fn() },
    titleAlias: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/media-assets", () => ({
  cacheRemoteMediaAsset: vi.fn(),
  isLocalMediaAssetUrl: vi.fn((value: string | null | undefined) =>
    Boolean(value?.startsWith("/api/media-assets/")),
  ),
}));

vi.mock("@/lib/media-title-repair", () => ({
  addMediaTitleAliases: vi.fn(),
  findExistingMediaTitle: vi.fn(),
}));

vi.mock("@/lib/organizer-lifecycle", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/organizer-lifecycle")>()),
  moveOrganizerFiles: vi.fn(),
  prepareOrganizerAria2Task: vi.fn().mockResolvedValue(null),
  restoreOrganizerAria2Task: vi.fn().mockResolvedValue(false),
  rollbackOrganizerFiles: vi.fn(),
}));

vi.mock("@/lib/settings", () => ({
  getAppSettings: vi.fn(),
}));

const plan = {
  id: "plan-1",
  mediaType: "ANIME" as const,
  mediaTitleId: null,
  status: "PENDING" as const,
  confidence: 0.96,
  autoExecutable: true,
  reason: "Ready for confirmation",
  updatedAt: new Date("2026-07-29T08:00:00.000Z"),
  downloadId: "download-1",
  metadata: {
    title: "Some Anime",
    posterUrl: "https://image.example/poster.jpg",
  },
  candidate: {
    mediaType: "ANIME" as const,
    parsedTitle: "Some Anime",
    normalizedTitle: "some anime",
    season: 1,
    episodeNumber: 1,
    resolution: "1080p",
    codec: "HEVC",
    subtitleGroup: "SomeGroup",
    group: {
      displayTitle: "Some Anime",
      normalizedTitle: "some anime",
      aliases: [],
    },
  },
  download: {
    id: "download-1",
    aria2Gid: null,
    archiveStatus: null,
  },
  items: [
    {
      id: "item-1",
      sourcePath: "/data/downloads/Some Anime - 01.mkv",
      targetPath: "/data/library/anime/Some Anime/Season 01/Some Anime - S01E01.mkv",
      originalName: "Some Anime - 01.mkv",
      fileType: "video",
      sizeBytes: 1_024n,
      conflict: false,
      conflictReason: null,
    },
  ],
};

describe("executeOrganizerPlan transactional finalization", () => {
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
    vi.mocked(prisma.organizerPlan.findUniqueOrThrow).mockResolvedValue(plan as never);
    vi.mocked(prisma.organizerPlan.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.operationLog.create).mockResolvedValue({
      id: "operation-1",
    } as never);
    vi.mocked(prisma.operationLog.update).mockResolvedValue({} as never);
    vi.mocked(moveOrganizerFiles).mockResolvedValue(plan.items);
    vi.mocked(rollbackOrganizerFiles).mockResolvedValue({
      restored: plan.items,
      skipped: [],
      errors: [],
    });
    vi.mocked(findExistingMediaTitle).mockResolvedValue({
      id: "media-1",
    } as never);
    vi.mocked(addMediaTitleAliases).mockResolvedValue({ created: 0 });
    vi.mocked(prisma.mediaTitle.update).mockResolvedValue({ id: "media-1" } as never);
    vi.mocked(prisma.season.upsert).mockResolvedValue({ id: "season-1" } as never);
    vi.mocked(prisma.episode.upsert).mockResolvedValue({ id: "episode-1" } as never);
    vi.mocked(prisma.mediaFile.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.mediaFile.create).mockResolvedValue({ id: "file-1" } as never);
    vi.mocked(prisma.download.update).mockResolvedValue({ id: "download-1" } as never);
    vi.mocked(prisma.organizerPlan.update).mockResolvedValue({
      ...plan,
      status: "AUTO_ARCHIVED",
      mediaTitleId: "media-1",
    } as never);
    vi.mocked(cacheRemoteMediaAsset)
      .mockResolvedValueOnce("/api/media-assets/covers/media-1-poster.jpg")
      .mockResolvedValueOnce(undefined);
    vi.mocked(fs.access)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "ENOENT" }));
  });

  it("commits media, download, plan, and audit state in one transaction", async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) =>
      (callback as (database: typeof prisma) => Promise<unknown>)(prisma),
    );

    await expect(executeOrganizerPlan("plan-1", true)).resolves.toMatchObject({
      status: "AUTO_ARCHIVED",
      mediaTitleId: "media-1",
    });

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 5_000,
      timeout: 30_000,
    });
    expect(findExistingMediaTitle).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Some Anime" }),
      prisma,
    );
    expect(addMediaTitleAliases).toHaveBeenCalledWith(
      "media-1",
      expect.any(Array),
      prisma,
    );
    expect(prisma.download.update).toHaveBeenCalledWith({
      where: { id: "download-1" },
      data: { archiveStatus: "auto_archived" },
    });
    expect(prisma.organizerPlan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "AUTO_ARCHIVED",
          mediaTitleId: "media-1",
        }),
      }),
    );
    expect(prisma.operationLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "operation-1" },
        data: expect.objectContaining({ status: "SUCCEEDED" }),
      }),
    );
    expect(prisma.operationLog.update.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(cacheRemoteMediaAsset).mock.invocationCallOrder[0],
    );
  });

  it("restores moved files when the database transaction cannot commit", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(
      new Error("database transaction failed"),
    );

    await expect(executeOrganizerPlan("plan-1", true)).rejects.toThrow(
      "database transaction failed",
    );

    expect(rollbackOrganizerFiles).toHaveBeenCalledWith(
      plan.items,
      expect.arrayContaining(["/data"]),
    );
    expect(prisma.organizerPlan.updateMany).toHaveBeenLastCalledWith({
      where: { id: "plan-1", status: "EXECUTING" },
      data: {
        status: "FAILED",
        autoExecutable: false,
        reason: "database transaction failed",
      },
    });
    expect(prisma.operationLog.update).toHaveBeenCalledWith({
      where: { id: "operation-1" },
      data: expect.objectContaining({
        status: "FAILED",
        errorMessage: "database transaction failed",
      }),
    });
    expect(cacheRemoteMediaAsset).not.toHaveBeenCalled();
  });
});
