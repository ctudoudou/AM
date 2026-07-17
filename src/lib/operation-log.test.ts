import { beforeEach, describe, expect, it, vi } from "vitest";
import { resumeAria2Download } from "@/lib/aria2";
import { prisma } from "@/lib/db";
import {
  listOperationLogs,
  OPERATION_ROLLBACK_CONFIRMATION,
  OperationRollbackValidationError,
  rollbackOperation,
} from "./operation-log";

vi.mock("@/lib/aria2", () => ({
  resumeAria2Download: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    operationLog: {
      create: vi.fn(),
      findMany: vi.fn(),
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
    vi.mocked(prisma.$transaction).mockResolvedValue([] as never);
    vi.mocked(resumeAria2Download).mockResolvedValue("gid-1");
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
    expect(prisma.operationLog.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
