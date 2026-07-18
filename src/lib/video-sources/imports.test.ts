import { beforeEach, describe, expect, it, vi } from "vitest";
import { addHttpUrlToAria2 } from "@/lib/aria2";
import { prisma } from "@/lib/db";
import { parseMediaReleaseTitle } from "@/lib/media-parser";
import { getAppSettings } from "@/lib/settings";
import { buildVideoImportFilename, queueVideoSourceImports } from "./imports";
import { inspectVideoSource } from "./registry";
import { resolveVideoEpisode } from "./resolver";

vi.mock("./registry", () => ({
  inspectVideoSource: vi.fn(),
  assertVideoSourcePlanCurrent: vi.fn(),
}));

vi.mock("./resolver", () => ({
  resolveVideoEpisode: vi.fn(),
}));

vi.mock("@/lib/aria2", () => ({
  addHttpUrlToAria2: vi.fn(),
  removeAria2Download: vi.fn(),
  removeAria2DownloadResult: vi.fn(),
}));

vi.mock("@/lib/settings", () => ({
  getAppSettings: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: vi.fn(),
    videoSourceImport: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    download: { update: vi.fn(), findUniqueOrThrow: vi.fn() },
    releaseCandidate: { update: vi.fn() },
    operationLog: { create: vi.fn(), update: vi.fn() },
  },
}));

const inspected = {
  planId: "a".repeat(64),
  provider: "agedm",
  providerName: "AGE动漫",
  sourceItemId: "20250111",
  sourceUrl: "https://www.agedm.io/detail/20250111",
  canonicalUrl: "https://www.agedm.io/detail/20250111",
  kind: "detail" as const,
  title: "测试/动画",
  description: null,
  posterUrl: null,
  seasonNumber: 1,
  episodes: [
    { key: "episode:1", number: 1, label: "第01集", sources: [] },
    { key: "episode:2", number: 2, label: "第02集", sources: [] },
  ],
};

describe("video source imports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(inspectVideoSource).mockResolvedValue(inspected);
    vi.mocked(getAppSettings).mockResolvedValue({
      directories: { downloadsDir: "/data/downloads" },
    } as never);
    vi.mocked(resolveVideoEpisode).mockResolvedValue({
      provider: "agedm",
      sourceId: "line:1",
      sourcePageUrl: "https://www.agedm.io/play/20250111/1/1",
      mediaUrl: "https://cdn.example.test/signed-video",
      mediaHost: "cdn.example.test",
      format: "mp4",
      contentType: "video/mp4",
      sizeBytes: BigInt(100_000_000),
      requestHeaders: {},
    });
    vi.mocked(addHttpUrlToAria2).mockResolvedValue("gid-1");
    vi.mocked(prisma.videoSourceImport.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.videoSourceImport.update).mockResolvedValue({} as never);
    vi.mocked(prisma.download.update).mockResolvedValue({} as never);
    vi.mocked(prisma.releaseCandidate.update).mockResolvedValue({} as never);
    vi.mocked(prisma.operationLog.create).mockResolvedValue({ id: "operation-1" } as never);
    vi.mocked(prisma.operationLog.update).mockResolvedValue({} as never);

    const tx = {
      releaseCandidateGroup: {
        upsert: vi.fn().mockResolvedValue({ id: "group-1" }),
      },
      rssItem: { create: vi.fn().mockResolvedValue({ id: "rss-1" }) },
      releaseCandidate: {
        create: vi.fn().mockResolvedValue({ id: "candidate-1" }),
      },
      download: { create: vi.fn().mockResolvedValue({ id: "download-1" }) },
      videoSourceImport: {
        create: vi.fn().mockResolvedValue({
          id: "import-1",
          provider: "agedm",
          sourceItemId: "20250111",
          episodeKey: "episode:1",
          sourcePageUrl: inspected.sourceUrl,
          title: inspected.title,
          seasonNumber: 1,
          episodeNumber: 1,
          posterUrl: null,
          selectedSourceId: null,
          mediaFormat: null,
          mediaHost: null,
          sizeBytes: null,
          outputFilename: null,
          status: "RESOLVING",
          errorMessage: null,
          candidateId: "candidate-1",
          downloadId: "download-1",
          createdAt: new Date(),
          updatedAt: new Date(),
          download: { id: "download-1", status: "WAITING", aria2Gid: null },
        }),
      },
    };
    vi.mocked(prisma.$transaction).mockImplementation(async (input: unknown) => {
      if (typeof input === "function") {
        return (input as (client: typeof tx) => unknown)(tx);
      }
      return Promise.all(input as Promise<unknown>[]);
    });
  });

  it("rejects duplicate or unknown episode selections before creating records", async () => {
    await expect(
      queueVideoSourceImports({
        url: inspected.sourceUrl,
        planId: inspected.planId,
        episodeKeys: ["episode:1", "episode:1"],
      }),
    ).rejects.toThrow("unique episodes");
    await expect(
      queueVideoSourceImports({
        url: inspected.sourceUrl,
        planId: inspected.planId,
        episodeKeys: ["episode:9"],
      }),
    ).rejects.toThrow("not part of the current source plan");
  });

  it("builds an organizer-readable and path-safe output filename", () => {
    const filename = buildVideoImportFilename('测试/动画: "OVA"', 1, 2, "agedm");
    expect(filename).toBe(
      "[AGEDM] 测试 动画 OVA - S01E02 [WEB].mp4",
    );
    expect(parseMediaReleaseTitle(filename, "ANIME")).toMatchObject({
      parsedTitle: "测试 动画 OVA",
      season: 1,
      episodeNumber: 2,
    });
  });

  it("queues a resolved direct MP4 without persisting its signed URL", async () => {
    const result = await queueVideoSourceImports({
      url: inspected.sourceUrl,
      planId: inspected.planId,
      episodeKeys: ["episode:1"],
    });

    expect(result).toMatchObject({ requested: 1, queued: 1, skipped: 0, failed: 0 });
    expect(addHttpUrlToAria2).toHaveBeenCalledWith(
      "https://cdn.example.test/signed-video",
      "/data/downloads",
      expect.objectContaining({
        out: "[AGEDM] 测试 动画 - S01E01 [WEB].mp4",
        continue: "true",
        "auto-file-renaming": "false",
      }),
    );
    expect(prisma.videoSourceImport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "QUEUED",
          mediaHost: "cdn.example.test",
          selectedSourceId: "line:1",
        }),
      }),
    );
    expect(
      JSON.stringify(
        vi.mocked(prisma.videoSourceImport.update).mock.calls,
        (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      ),
    ).not.toContain("signed-video");
  });
});
