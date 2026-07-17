import { beforeEach, describe, expect, it, vi } from "vitest";
import { pauseAria2Download } from "@/lib/aria2";
import { prisma } from "@/lib/db";
import {
  DOWNLOAD_RECONCILIATION_CONFIRMATION,
  DownloadReconciliationPlanStaleError,
  DownloadReconciliationValidationError,
  executeDownloadReconciliationPlanFromSnapshot,
} from "./download-reconciliation";

vi.mock("@/lib/aria2", () => ({
  listKnownDownloads: vi.fn(),
  pauseAria2Download: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    download: { findMany: vi.fn() },
    operationLog: { create: vi.fn(), update: vi.fn() },
  },
}));

const executablePlan = {
  planId: "a".repeat(64),
  createdAt: "2026-07-17T00:00:00.000Z",
  warnings: [],
  summary: {
    downloads: 1,
    knownAria2: 1,
    trackedAria2: 1,
    untrackedAria2: 0,
    anomalies: 1,
    archivedActive: 1,
    safePause: 1,
    manualReview: 0,
    byKind: {
      archived_active: 1,
      archived_result: 0,
      untracked_payload: 0,
      untracked_metadata: 0,
      untracked_error: 0,
      ambiguous_match: 0,
    },
  },
  items: [
    {
      actionId: "archived_active:verified",
      kind: "archived_active" as const,
      gid: "gid-1",
      aria2Status: "active" as const,
      title: "Show 01",
      downloadId: "download-1",
      candidateDownloadIds: ["download-1"],
      archiveStatus: "archived",
      matchedBy: "gid" as const,
      recommendedAction: "pause" as const,
      safeToPause: true,
      executable: false as const,
      reason: "verified",
      payloadFiles: ["/data/downloads/show.mkv"],
      payloadFileCount: 1,
      completedBytes: "10",
      totalBytes: "100",
      libraryTargets: [
        {
          path: "/data/library/anime/Show/Show - S01E01.mkv",
          expectedBytes: "100",
          actualBytes: "100",
          state: "complete" as const,
        },
      ],
    },
  ],
};

describe("download reconciliation execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.operationLog.create).mockResolvedValue({ id: "audit-1" } as never);
    vi.mocked(prisma.operationLog.update).mockResolvedValue({ id: "audit-1" } as never);
    vi.mocked(pauseAria2Download).mockResolvedValue("gid-1");
  });

  it("pauses only a verified item and records an audit operation", async () => {
    await expect(
      executeDownloadReconciliationPlanFromSnapshot(executablePlan, {
        planId: executablePlan.planId,
        actionIds: ["archived_active:verified"],
        confirmation: DOWNLOAD_RECONCILIATION_CONFIRMATION,
      }),
    ).resolves.toMatchObject({ requested: 1, succeeded: 1, failed: 0 });

    expect(pauseAria2Download).toHaveBeenCalledWith("gid-1");
    expect(prisma.operationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "PAUSE_ARCHIVED_REDOWNLOAD",
        status: "STARTED",
        entityId: "download-1",
        externalId: "gid-1",
        planId: executablePlan.planId,
      }),
    });
    expect(prisma.operationLog.update).toHaveBeenCalledWith({
      where: { id: "audit-1" },
      data: expect.objectContaining({ status: "SUCCEEDED" }),
    });
  });

  it("records a failed audit result when aria2 rejects the pause", async () => {
    vi.mocked(pauseAria2Download).mockRejectedValue(new Error("cannot pause"));

    await expect(
      executeDownloadReconciliationPlanFromSnapshot(executablePlan, {
        planId: executablePlan.planId,
        actionIds: ["archived_active:verified"],
        confirmation: DOWNLOAD_RECONCILIATION_CONFIRMATION,
      }),
    ).resolves.toMatchObject({ requested: 1, succeeded: 0, failed: 1 });
    expect(prisma.operationLog.update).toHaveBeenCalledWith({
      where: { id: "audit-1" },
      data: expect.objectContaining({ status: "FAILED", errorMessage: "cannot pause" }),
    });
  });

  it("does not report a successful aria2 pause as failed when audit finalization fails", async () => {
    vi.mocked(prisma.operationLog.update).mockRejectedValueOnce(new Error("audit unavailable"));

    await expect(
      executeDownloadReconciliationPlanFromSnapshot(executablePlan, {
        planId: executablePlan.planId,
        actionIds: ["archived_active:verified"],
        confirmation: DOWNLOAD_RECONCILIATION_CONFIRMATION,
      }),
    ).resolves.toMatchObject({ requested: 1, succeeded: 1, failed: 0 });
    expect(pauseAria2Download).toHaveBeenCalledWith("gid-1");
  });

  it("rejects stale plans before pausing anything", async () => {
    await expect(
      executeDownloadReconciliationPlanFromSnapshot(executablePlan, {
        planId: "b".repeat(64),
        actionIds: ["archived_active:verified"],
        confirmation: DOWNLOAD_RECONCILIATION_CONFIRMATION,
      }),
    ).rejects.toBeInstanceOf(DownloadReconciliationPlanStaleError);
    expect(pauseAria2Download).not.toHaveBeenCalled();
  });

  it("rejects review-only items before pausing anything", async () => {
    const reviewPlan = {
      ...executablePlan,
      items: [
        {
          ...executablePlan.items[0],
          safeToPause: false,
          recommendedAction: "review",
        },
      ],
    };

    await expect(
      executeDownloadReconciliationPlanFromSnapshot(reviewPlan, {
        planId: executablePlan.planId,
        actionIds: ["archived_active:verified"],
        confirmation: DOWNLOAD_RECONCILIATION_CONFIRMATION,
      }),
    ).rejects.toBeInstanceOf(DownloadReconciliationValidationError);
    expect(pauseAria2Download).not.toHaveBeenCalled();
  });
});
