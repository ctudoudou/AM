import path from "node:path";
import { Prisma } from "@prisma/client";
import { resumeAria2Download } from "@/lib/aria2";
import { prisma } from "@/lib/db";
import {
  moveOrganizerFiles,
  rollbackOrganizerFiles,
  type OrganizerMove,
} from "@/lib/organizer-lifecycle";
import { ORGANIZER_OPERATION_ROLLBACK_CONFIRMATION } from "@/lib/organizer-confirmations";
import { getAppSettings } from "@/lib/settings";

export const OPERATION_ROLLBACK_CONFIRMATION =
  "I understand this resumes the audited aria2 task";
export { ORGANIZER_OPERATION_ROLLBACK_CONFIRMATION };

export class OperationRollbackValidationError extends Error {}

export async function listOperationLogs(input: {
  domain?: string;
  status?: string;
  limit?: number;
}) {
  const limit = Math.min(100, Math.max(1, input.limit ?? 25));
  return prisma.operationLog.findMany({
    where: {
      ...(input.domain ? { domain: input.domain } : {}),
      ...(input.status ? { status: input.status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function rollbackOperation(input: {
  operationId: string;
  confirmation: string;
}) {
  const operation = await prisma.operationLog.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  if (
    operation.domain === "ORGANIZER" &&
    ["EXECUTE_MOVE", "REPAIR_LEGACY_MISARCHIVE"].includes(operation.action)
  ) {
    if (input.confirmation !== ORGANIZER_OPERATION_ROLLBACK_CONFIRMATION) {
      throw new OperationRollbackValidationError(
        "Organizer rollback confirmation phrase does not match.",
      );
    }
    return operation.action === "REPAIR_LEGACY_MISARCHIVE"
      ? rollbackLegacyMisarchiveOperation(operation)
      : rollbackOrganizerOperation(operation);
  }
  if (input.confirmation !== OPERATION_ROLLBACK_CONFIRMATION) {
    throw new OperationRollbackValidationError(
      "Operation rollback confirmation phrase does not match.",
    );
  }
  if (
    operation.domain !== "DOWNLOAD" ||
    operation.action !== "PAUSE_ARCHIVED_REDOWNLOAD" ||
    operation.status !== "SUCCEEDED"
  ) {
    throw new OperationRollbackValidationError(
      "Only a successful archived-redownload pause can be rolled back here.",
    );
  }
  const rollback = parseAria2Rollback(operation.rollbackData);
  if (!rollback) {
    throw new OperationRollbackValidationError(
      "The operation has no valid aria2 unpause rollback evidence.",
    );
  }

  const audit = await prisma.operationLog.create({
    data: {
      domain: "DOWNLOAD",
      action: "ROLLBACK_PAUSE_ARCHIVED_REDOWNLOAD",
      status: "STARTED",
      entityType: operation.entityType,
      entityId: operation.entityId,
      externalId: rollback.gid,
      planId: operation.planId,
      details: {
        rollbackOf: operation.id,
        action: rollback.action,
        gid: rollback.gid,
      } as Prisma.InputJsonValue,
    },
  });
  try {
    await resumeAria2Download(rollback.gid);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to resume aria2 task";
    await prisma.operationLog
      .update({
        where: { id: audit.id },
        data: { status: "FAILED", errorMessage: message, completedAt: new Date() },
      })
      .catch(() => null);
    throw error;
  }

  try {
    const completedAt = new Date();
    await prisma.$transaction([
      prisma.operationLog.update({
        where: { id: audit.id },
        data: { status: "SUCCEEDED", completedAt },
      }),
      prisma.operationLog.update({
        where: { id: operation.id },
        data: { status: "ROLLED_BACK", completedAt },
      }),
    ]);
    return { operationId: operation.id, rollbackOperationId: audit.id, gid: rollback.gid };
  } catch (error) {
    const cause = error instanceof Error ? error.message : "Unknown audit error";
    const message = `aria2 task resumed, but rollback audit finalization failed: ${cause}`;
    await prisma.operationLog
      .update({
        where: { id: audit.id },
        data: { status: "FAILED", errorMessage: message, completedAt: new Date() },
      })
      .catch(() => null);
    throw error;
  }
}

async function rollbackLegacyMisarchiveOperation(
  operation: Awaited<ReturnType<typeof prisma.operationLog.findUniqueOrThrow>>,
) {
  if (operation.status !== "SUCCEEDED" || !operation.entityId) {
    throw new OperationRollbackValidationError(
      "Only a successful legacy organizer repair can be rolled back.",
    );
  }
  const moves = parseOrganizerRollback(operation.rollbackData);
  const repair = parseLegacyRepairRollback(operation.rollbackData);
  if (!moves || moves.length !== 1 || !repair) {
    throw new OperationRollbackValidationError(
      "The operation has no valid legacy organizer rollback evidence.",
    );
  }
  const [move] = moves;
  const [plan, planItem, mediaFile] = await Promise.all([
    prisma.organizerPlan.findUniqueOrThrow({
      where: { id: operation.entityId },
      select: { id: true, status: true },
    }),
    prisma.organizerPlanItem.findUniqueOrThrow({ where: { id: repair.planItemId } }),
    prisma.mediaFile.findUniqueOrThrow({ where: { id: repair.mediaFileId } }),
  ]);
  if (
    !["EXECUTED", "AUTO_ARCHIVED"].includes(plan.status) ||
    planItem.planId !== plan.id ||
    planItem.targetPath !== repair.newPath ||
    planItem.fileType !== "video" ||
    mediaFile.absolutePath !== repair.newPath ||
    move.sourcePath !== repair.newPath ||
    move.targetPath !== repair.oldPath
  ) {
    throw new OperationRollbackValidationError(
      "Legacy organizer repair state changed after execution; refusing an unsafe rollback.",
    );
  }
  const leased = await prisma.operationLog.updateMany({
    where: { id: operation.id, status: "SUCCEEDED" },
    data: { status: "ROLLBACK_STARTED" },
  });
  if (leased.count !== 1) {
    throw new OperationRollbackValidationError(
      "The legacy organizer repair is already being rolled back.",
    );
  }
  const audit = await prisma.operationLog.create({
    data: {
      domain: "ORGANIZER",
      action: "ROLLBACK_REPAIR_LEGACY_MISARCHIVE",
      status: "STARTED",
      entityType: operation.entityType,
      entityId: operation.entityId,
      planId: operation.planId,
      details: { rollbackOf: operation.id, moves, repair } as Prisma.InputJsonValue,
    },
  });
  let allowedRoots: string[] = [];
  let moved: OrganizerMove[] = [];
  let databaseFinalized = false;
  try {
    const settings = await getAppSettings();
    allowedRoots = organizerAllowedRoots(settings.directories);
    moved = await moveOrganizerFiles(moves, allowedRoots);
    await prisma.$transaction(async (database) => {
      await database.organizerPlanItem.update({
        where: { id: repair.planItemId },
        data: {
          targetPath: repair.oldPath,
          fileType: "extra_video",
          conflict: false,
          conflictReason: null,
        },
      });
      await database.mediaFile.update({
        where: { id: repair.mediaFileId },
        data: {
          episodeId: repair.previousEpisodeId,
          relativePath: repair.oldPath,
          absolutePath: repair.oldPath,
        },
      });
      if (!repair.episodePreviouslyExisted) {
        await database.episode.deleteMany({
          where: {
            id: repair.repairedEpisodeId,
            files: { none: {} },
            progress: { none: {} },
            subtitles: { none: {} },
          },
        });
      }
      const completedAt = new Date();
      await database.operationLog.update({
        where: { id: audit.id },
        data: { status: "SUCCEEDED", completedAt },
      });
      await database.operationLog.update({
        where: { id: operation.id },
        data: { status: "ROLLED_BACK", completedAt },
      });
    });
    databaseFinalized = true;
    return {
      operationId: operation.id,
      rollbackOperationId: audit.id,
      restored: moved.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Legacy organizer rollback failed";
    const compensation =
      !databaseFinalized && moved.length > 0
        ? await rollbackOrganizerFiles(moved, allowedRoots)
        : null;
    const stateMessage =
      compensation?.errors.length
        ? `${message}; file compensation was incomplete`
        : message;
    await Promise.all([
      prisma.operationLog
        .update({
          where: { id: audit.id },
          data: { status: "FAILED", completedAt: new Date(), errorMessage: stateMessage },
        })
        .catch(() => null),
      prisma.operationLog
        .updateMany({
          where: { id: operation.id, status: "ROLLBACK_STARTED" },
          data: { status: databaseFinalized ? "ROLLBACK_FAILED" : "SUCCEEDED" },
        })
        .catch(() => null),
    ]);
    throw error;
  }
}

async function rollbackOrganizerOperation(
  operation: Awaited<ReturnType<typeof prisma.operationLog.findUniqueOrThrow>>,
) {
  if (operation.status !== "SUCCEEDED" || !operation.entityId) {
    throw new OperationRollbackValidationError(
      "Only a successful organizer move can be rolled back.",
    );
  }
  const moves = parseOrganizerRollback(operation.rollbackData);
  if (!moves) {
    throw new OperationRollbackValidationError(
      "The operation has no valid organizer file rollback evidence.",
    );
  }
  const plan = await prisma.organizerPlan.findUniqueOrThrow({
    where: { id: operation.entityId },
    select: { id: true, status: true, downloadId: true },
  });
  if (!["EXECUTED", "AUTO_ARCHIVED"].includes(plan.status)) {
    throw new OperationRollbackValidationError(
      "The organizer plan is not in a completed state.",
    );
  }
  const leased = await prisma.operationLog.updateMany({
    where: { id: operation.id, status: "SUCCEEDED" },
    data: { status: "ROLLBACK_STARTED" },
  });
  if (leased.count !== 1) {
    throw new OperationRollbackValidationError(
      "The organizer operation is already being rolled back.",
    );
  }

  const audit = await prisma.operationLog
    .create({
      data: {
        domain: "ORGANIZER",
        action: "ROLLBACK_EXECUTE_MOVE",
        status: "STARTED",
        entityType: operation.entityType,
        entityId: operation.entityId,
        externalId: operation.externalId,
        planId: operation.planId,
        details: {
          rollbackOf: operation.id,
          moves,
        } as Prisma.InputJsonValue,
      },
    })
    .catch(async (error) => {
      await prisma.operationLog
        .updateMany({
          where: { id: operation.id, status: "ROLLBACK_STARTED" },
          data: { status: "SUCCEEDED" },
        })
        .catch(() => null);
      throw error;
    });

  let allowedRoots: string[] = [];
  let moved: OrganizerMove[] = [];
  let databaseFinalized = false;
  try {
    const settings = await getAppSettings();
    allowedRoots = organizerAllowedRoots(settings.directories);
    moved = await moveOrganizerFiles(moves, allowedRoots);
    await prisma.$transaction([
      prisma.mediaFile.deleteMany({
        where: { absolutePath: { in: moves.map((move) => move.sourcePath) } },
      }),
      prisma.organizerPlan.update({
        where: { id: plan.id },
        data: {
          status: "NEEDS_REVIEW",
          autoExecutable: false,
          reason: `Rolled back organizer operation ${operation.id}. Review before executing again.`,
          executedAt: null,
          mediaTitleId: null,
        },
      }),
      ...(plan.downloadId
        ? [
            prisma.download.update({
              where: { id: plan.downloadId },
              data: { archiveStatus: null },
            }),
          ]
        : []),
    ]);
    databaseFinalized = true;

    const aria2Rollback = parseAria2RollbackFromOrganizer(operation.rollbackData);
    if (aria2Rollback) {
      await resumeAria2Download(aria2Rollback.gid);
    }

    const completedAt = new Date();
    await prisma.$transaction([
      prisma.operationLog.update({
        where: { id: audit.id },
        data: { status: "SUCCEEDED", completedAt },
      }),
      prisma.operationLog.update({
        where: { id: operation.id },
        data: { status: "ROLLED_BACK", completedAt },
      }),
    ]);
    return {
      operationId: operation.id,
      rollbackOperationId: audit.id,
      restored: moves.length,
      aria2Gid: aria2Rollback?.gid ?? null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Organizer rollback failed";
    const compensation =
      !databaseFinalized && moved.length > 0
        ? await rollbackOrganizerFiles(moved, allowedRoots)
        : null;
    const stateMessage = databaseFinalized
      ? `Organizer files and database were restored, but rollback finalization failed: ${message}`
      : compensation && compensation.errors.length > 0
        ? `Organizer rollback failed and compensation was incomplete: ${message}`
        : message;
    await Promise.all([
      prisma.operationLog
        .update({
          where: { id: audit.id },
          data: { status: "FAILED", errorMessage: stateMessage, completedAt: new Date() },
        })
        .catch(() => null),
      prisma.operationLog
        .updateMany({
          where: { id: operation.id, status: "ROLLBACK_STARTED" },
          data: {
            status: databaseFinalized ? "ROLLBACK_FAILED" : "SUCCEEDED",
            errorMessage: databaseFinalized ? stateMessage : operation.errorMessage,
          },
        })
        .catch(() => null),
    ]);
    throw error;
  }
}

function parseAria2Rollback(value: Prisma.JsonValue) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const action = value.action;
  const gid = value.gid;
  return action === "unpause" && typeof gid === "string" && gid.length > 0
    ? { action, gid }
    : null;
}

function parseAria2RollbackFromOrganizer(value: Prisma.JsonValue) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return parseAria2Rollback(value.aria2 ?? null);
}

function parseOrganizerRollback(value: Prisma.JsonValue): OrganizerMove[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.moves)) {
    return null;
  }
  if (value.moves.length === 0 || value.moves.length > 500) {
    return null;
  }
  const moves: OrganizerMove[] = [];
  const sources = new Set<string>();
  const targets = new Set<string>();
  for (const valueMove of value.moves) {
    if (!valueMove || typeof valueMove !== "object" || Array.isArray(valueMove)) {
      return null;
    }
    const sourcePath = valueMove.sourcePath;
    const targetPath = valueMove.targetPath;
    if (
      typeof sourcePath !== "string" ||
      typeof targetPath !== "string" ||
      !path.isAbsolute(sourcePath) ||
      !path.isAbsolute(targetPath) ||
      sourcePath === targetPath ||
      sources.has(sourcePath) ||
      targets.has(targetPath)
    ) {
      return null;
    }
    sources.add(sourcePath);
    targets.add(targetPath);
    moves.push({ sourcePath, targetPath });
  }
  return moves;
}

function parseLegacyRepairRollback(value: Prisma.JsonValue) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const repair = value.legacyRepair;
  if (!repair || typeof repair !== "object" || Array.isArray(repair)) {
    return null;
  }
  const {
    planItemId,
    mediaFileId,
    previousEpisodeId,
    repairedEpisodeId,
    episodePreviouslyExisted,
    oldPath,
    newPath,
  } = repair;
  if (
    typeof planItemId !== "string" ||
    typeof mediaFileId !== "string" ||
    (previousEpisodeId !== null && typeof previousEpisodeId !== "string") ||
    typeof repairedEpisodeId !== "string" ||
    typeof episodePreviouslyExisted !== "boolean" ||
    typeof oldPath !== "string" ||
    typeof newPath !== "string" ||
    !path.isAbsolute(oldPath) ||
    !path.isAbsolute(newPath) ||
    oldPath === newPath
  ) {
    return null;
  }
  return {
    planItemId,
    mediaFileId,
    previousEpisodeId,
    repairedEpisodeId,
    episodePreviouslyExisted,
    oldPath,
    newPath,
  };
}

function organizerAllowedRoots(directories: {
  dataRoot: string;
  downloadsDir: string;
  stagingDir: string;
  animeLibraryDir: string;
  moviesLibraryDir: string;
  tvLibraryDir: string;
  metadataDir: string;
  transcodesDir: string;
}) {
  return [
    directories.dataRoot,
    directories.downloadsDir,
    directories.stagingDir,
    directories.animeLibraryDir,
    directories.moviesLibraryDir,
    directories.tvLibraryDir,
    directories.metadataDir,
    directories.transcodesDir,
  ].map((root) => path.resolve(root));
}
