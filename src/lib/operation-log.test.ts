import { beforeEach, describe, expect, it, vi } from "vitest";
import { resumeAria2Download } from "@/lib/aria2";
import { prisma } from "@/lib/db";
import {
  listOperationLogs,
  OPERATION_ROLLBACK_CONFIRMATION,
  ORGANIZER_OPERATION_ROLLBACK_CONFIRMATION,
  OperationRollbackValidationError,
  rollbackOperation,
} from "./operation-log";
import { moveOrganizerFiles, rollbackOrganizerFiles } from "@/lib/organizer-lifecycle";
import { getAppSettings } from "@/lib/settings";

vi.mock("@/lib/aria2", () => ({
  resumeAria2Download: vi.fn(),
}));

vi.mock("@/lib/organizer-lifecycle", () => ({
  moveOrganizerFiles: vi.fn(),
  rollbackOrganizerFiles: vi.fn(),
}));

vi.mock("@/lib/settings", () => ({
  getAppSettings: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    download: {
      update: vi.fn(),
    },
    mediaFile: {
      deleteMany: vi.fn(),
    },
    operationLog: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    organizerPlan: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

describe("operation log", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.operationLog.findMany).mockResolvedValue([]);
    vi.mocked(prisma.operationLog.findUniqueOrThrow).mockResolvedValue({
      id: "operation-1",
      domain: "DOWNLOAD",
      action: "PAUSE_ARCHIVED_REDOWNLOAD",
      status: "SUCCEEDED",
      entityType: "Download",
      entityId: "download-1",
      externalId: "gid-1",
      planId: "plan-1",
      rollbackData: { action: "unpause", gid: "gid-1" },
    } as never);
    vi.mocked(prisma.operationLog.create).mockResolvedValue({ id: "rollback-1" } as never);
    vi.mocked(prisma.operationLog.update).mockResolvedValue({} as never);
    vi.mocked(prisma.operationLog.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.organizerPlan.findUniqueOrThrow).mockResolvedValue({
      id: "plan-1",
      status: "EXECUTED",
      downloadId: "download-1",
    } as never);
    vi.mocked(prisma.organizerPlan.update).mockResolvedValue({} as never);
    vi.mocked(prisma.download.update).mockResolvedValue({} as never);
    vi.mocked(prisma.mediaFile.deleteMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.$transaction).mockResolvedValue([] as never);
    vi.mocked(resumeAria2Download).mockResolvedValue("gid-1");
    vi.mocked(moveOrganizerFiles).mockImplementation(async (moves) => moves);
    vi.mocked(rollbackOrganizerFiles).mockResolvedValue({
      restored: [],
      skipped: [],
      errors: [],
    });
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
  });

  it("lists recent operations with bounded filters", async () => {
    await listOperationLogs({ domain: "DOWNLOAD", status: "FAILED", limit: 500 });

    expect(prisma.operationLog.findMany).toHaveBeenCalledWith({
      where: { domain: "DOWNLOAD", status: "FAILED" },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  });

  it("resumes a verified paused task and records the rollback operation", async () => {
    await expect(
      rollbackOperation({
        operationId: "operation-1",
        confirmation: OPERATION_ROLLBACK_CONFIRMATION,
      }),
    ).resolves.toEqual({
      operationId: "operation-1",
      rollbackOperationId: "rollback-1",
      gid: "gid-1",
    });
    expect(resumeAria2Download).toHaveBeenCalledWith("gid-1");
    expect(prisma.operationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "ROLLBACK_PAUSE_ARCHIVED_REDOWNLOAD",
        status: "STARTED",
      }),
    });
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it("distinguishes audit finalization failure from aria2 resume failure", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValue(new Error("database unavailable"));

    await expect(
      rollbackOperation({
        operationId: "operation-1",
        confirmation: OPERATION_ROLLBACK_CONFIRMATION,
      }),
    ).rejects.toThrow("database unavailable");
    expect(resumeAria2Download).toHaveBeenCalledWith("gid-1");
    expect(prisma.operationLog.update).toHaveBeenCalledWith({
      where: { id: "rollback-1" },
      data: expect.objectContaining({
        status: "FAILED",
        errorMessage: expect.stringContaining("aria2 task resumed"),
      }),
    });
  });

  it("rejects rollback for unrelated or failed operations", async () => {
    vi.mocked(prisma.operationLog.findUniqueOrThrow).mockResolvedValue({
      id: "operation-1",
      domain: "ORGANIZER",
      action: "EXECUTE_MOVE",
      status: "SUCCEEDED",
    } as never);

    await expect(
      rollbackOperation({
        operationId: "operation-1",
        confirmation: OPERATION_ROLLBACK_CONFIRMATION,
      }),
    ).rejects.toBeInstanceOf(OperationRollbackValidationError);
    expect(resumeAria2Download).not.toHaveBeenCalled();
  });

  it("requires the exact rollback confirmation phrase", async () => {
    await expect(
      rollbackOperation({ operationId: "operation-1", confirmation: "yes" }),
    ).rejects.toBeInstanceOf(OperationRollbackValidationError);
    expect(prisma.operationLog.findUniqueOrThrow).toHaveBeenCalledOnce();
  });

  it("restores organizer files and reopens the plan under a separate confirmation", async () => {
    const moves = [
      {
        sourcePath: "/data/library/anime/Some Anime/Season 01/Some Anime - S01E01.mkv",
        targetPath: "/data/downloads/Some Anime - 01.mkv",
      },
    ];
    vi.mocked(prisma.operationLog.findUniqueOrThrow).mockResolvedValueOnce({
      id: "operation-1",
      domain: "ORGANIZER",
      action: "EXECUTE_MOVE",
      status: "SUCCEEDED",
      entityType: "OrganizerPlan",
      entityId: "plan-1",
      externalId: "gid-1",
      planId: "plan-1",
      errorMessage: null,
      rollbackData: {
        moves,
        aria2: { action: "unpause", gid: "gid-1" },
      },
    } as never);

    await expect(
      rollbackOperation({
        operationId: "operation-1",
        confirmation: ORGANIZER_OPERATION_ROLLBACK_CONFIRMATION,
      }),
    ).resolves.toMatchObject({
      operationId: "operation-1",
      rollbackOperationId: "rollback-1",
      restored: 1,
      aria2Gid: "gid-1",
    });

    expect(moveOrganizerFiles).toHaveBeenCalledWith(moves, expect.arrayContaining(["/data"]));
    expect(prisma.mediaFile.deleteMany).toHaveBeenCalledWith({
      where: { absolutePath: { in: [moves[0].sourcePath] } },
    });
    expect(prisma.organizerPlan.update).toHaveBeenCalledWith({
      where: { id: "plan-1" },
      data: expect.objectContaining({
        status: "NEEDS_REVIEW",
        executedAt: null,
        mediaTitleId: null,
      }),
    });
    expect(prisma.download.update).toHaveBeenCalledWith({
      where: { id: "download-1" },
      data: { archiveStatus: null },
    });
    expect(resumeAria2Download).toHaveBeenCalledWith("gid-1");
  });

  it("releases the organizer rollback lease when settings cannot be loaded", async () => {
    vi.mocked(prisma.operationLog.findUniqueOrThrow).mockResolvedValueOnce({
      id: "operation-1",
      domain: "ORGANIZER",
      action: "EXECUTE_MOVE",
      status: "SUCCEEDED",
      entityType: "OrganizerPlan",
      entityId: "plan-1",
      errorMessage: null,
      rollbackData: {
        moves: [
          {
            sourcePath: "/data/library/anime/Some Anime - S01E01.mkv",
            targetPath: "/data/downloads/Some Anime - 01.mkv",
          },
        ],
      },
    } as never);
    vi.mocked(getAppSettings).mockRejectedValueOnce(new Error("settings unavailable"));

    await expect(
      rollbackOperation({
        operationId: "operation-1",
        confirmation: ORGANIZER_OPERATION_ROLLBACK_CONFIRMATION,
      }),
    ).rejects.toThrow("settings unavailable");
    expect(prisma.operationLog.updateMany).toHaveBeenLastCalledWith({
      where: { id: "operation-1", status: "ROLLBACK_STARTED" },
      data: { status: "SUCCEEDED", errorMessage: null },
    });
  });

  it("compensates restored files when the database rollback fails", async () => {
    const moves = [
      {
        sourcePath: "/data/library/anime/Some Anime - S01E01.mkv",
        targetPath: "/data/downloads/Some Anime - 01.mkv",
      },
    ];
    vi.mocked(prisma.operationLog.findUniqueOrThrow).mockResolvedValueOnce({
      id: "operation-1",
      domain: "ORGANIZER",
      action: "EXECUTE_MOVE",
      status: "SUCCEEDED",
      entityType: "OrganizerPlan",
      entityId: "plan-1",
      errorMessage: null,
      rollbackData: { moves },
    } as never);
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(new Error("database unavailable"));

    await expect(
      rollbackOperation({
        operationId: "operation-1",
        confirmation: ORGANIZER_OPERATION_ROLLBACK_CONFIRMATION,
      }),
    ).rejects.toThrow("database unavailable");
    expect(rollbackOrganizerFiles).toHaveBeenCalledWith(
      moves,
      expect.arrayContaining(["/data"]),
    );
    expect(prisma.operationLog.updateMany).toHaveBeenLastCalledWith({
      where: { id: "operation-1", status: "ROLLBACK_STARTED" },
      data: { status: "SUCCEEDED", errorMessage: null },
    });
  });
});
