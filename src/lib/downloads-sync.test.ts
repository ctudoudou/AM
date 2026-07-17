import { beforeEach, describe, expect, it, vi } from "vitest";
import { tellKnownDownload } from "@/lib/aria2";
import { prisma } from "@/lib/db";
import { syncAria2Downloads } from "./downloads";

vi.mock("@/lib/aria2", () => ({
  addMagnetToAria2: vi.fn(),
  addTorrentToAria2: vi.fn(),
  addTorrentUrlToAria2: vi.fn(),
  listKnownDownloads: vi.fn().mockResolvedValue([]),
  pauseAria2Download: vi.fn(),
  removeAria2Download: vi.fn(),
  removeAria2DownloadResult: vi.fn(),
  resumeAria2Download: vi.fn(),
  tellKnownDownload: vi.fn(),
  mapAria2Status: (status: string) =>
    status === "error" || status === "removed" ? "FAILED" : status.toUpperCase(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    download: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    releaseCandidate: { update: vi.fn() },
    organizerPlan: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/organizer", () => ({
  createOrganizerPlanForDownload: vi.fn(),
}));

describe("aria2 download synchronization summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.download.findMany).mockResolvedValue([
      { id: "download-1", aria2Gid: "gid-1" },
    ] as never);
    vi.mocked(prisma.download.findUniqueOrThrow).mockResolvedValue({
      id: "download-1",
      candidateId: null,
      aria2Gid: "gid-1",
      infoHash: null,
      status: "ACTIVE",
      sourceUrl: "https://example.invalid/file.torrent",
      targetPath: null,
      progress: 0,
      totalBytes: BigInt(0),
      completedBytes: BigInt(0),
      downloadSpeed: BigInt(0),
      etaSeconds: null,
      aria2Files: null,
      errorMessage: null,
      supersededById: null,
    } as never);
    vi.mocked(prisma.download.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.download.update).mockResolvedValue({
      id: "download-1",
      status: "FAILED",
      errorMessage: "Permanent tracker failure",
    } as never);
    vi.mocked(tellKnownDownload).mockResolvedValue({
      gid: "gid-1",
      status: "error",
      errorMessage: "Permanent tracker failure",
      totalLength: "0",
      completedLength: "0",
      downloadSpeed: "0",
      files: [],
    });
  });

  it("counts every synchronized record that remains failed", async () => {
    await expect(syncAria2Downloads()).resolves.toEqual({
      synced: 1,
      failed: 1,
      errors: [{ id: "download-1", message: "Permanent tracker failure" }],
    });
  });
});
