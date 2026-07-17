import { Prisma } from "@prisma/client";
import { resumeAria2Download } from "@/lib/aria2";
import { prisma } from "@/lib/db";

export const OPERATION_ROLLBACK_CONFIRMATION =
  "I understand this resumes the audited aria2 task";

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
  if (input.confirmation !== OPERATION_ROLLBACK_CONFIRMATION) {
    throw new OperationRollbackValidationError(
      "Operation rollback confirmation phrase does not match.",
    );
  }
  const operation = await prisma.operationLog.findUniqueOrThrow({
    where: { id: input.operationId },
  });
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
