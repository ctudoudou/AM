import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Download, DownloadStatus } from "@prisma/client";
import { listKnownDownloads, type Aria2Status } from "@/lib/aria2";
import { prisma } from "@/lib/db";
import {
  extractBtInfoHash,
  isCompleteDownloadFileSize,
  normalizeBtInfoHash,
  retryFailedDownload,
  syncSingleAria2Download,
} from "@/lib/downloads";
import { getAppSettings } from "@/lib/settings";

export const DOWNLOAD_REPAIR_CONFIRMATION = "I understand this repairs download records";

export class DownloadRepairPlanStaleError extends Error {}
export class DownloadRepairValidationError extends Error {}

export type DownloadRepairKind =
  | "sync_existing_gid"
  | "adopt_aria2_gid"
  | "mark_completed"
  | "retry_source"
  | "supersede_duplicate"
  | "manual_review";

export type DownloadRepairConfidence = "high" | "medium" | "low";

export type DownloadRepairArtifact = {
  targetState: "none" | "missing" | "partial" | "complete" | "unsafe";
  expectedBytes: string;
  actualBytes: string;
  controlFileExists: boolean;
  savedTorrentExists: boolean;
};

export type DownloadRepairItem = {
  actionId: string;
  downloadId: string;
  title: string | null;
  kind: DownloadRepairKind;
  confidence: DownloadRepairConfidence;
  executable: boolean;
  reason: string;
  currentGid: string | null;
  replacementGid?: string;
  replacementInfoHash?: string | null;
  canonicalDownloadId?: string;
  targetPath: string | null;
  artifact: DownloadRepairArtifact;
  dependsOnActionId?: string;
};

export type DownloadRepairPlan = {
  planId: string;
  createdAt: string;
  downloadsDir: string;
  warnings: string[];
  summary: {
    failed: number;
    knownAria2: number;
    executable: number;
    review: number;
    byKind: Record<DownloadRepairKind, number>;
  };
  items: DownloadRepairItem[];
};

export type DownloadRepairExecutionResult = {
  planId: string;
  requested: number;
  succeeded: number;
  failed: number;
  skipped: number;
  results: Array<{
    actionId: string;
    downloadId: string;
    kind: DownloadRepairKind;
    status: "succeeded" | "failed" | "skipped";
    message: string;
  }>;
};

export type DownloadRepairRecord = Pick<
  Download,
  | "id"
  | "candidateId"
  | "aria2Gid"
  | "infoHash"
  | "status"
  | "sourceUrl"
  | "targetPath"
  | "title"
  | "totalBytes"
  | "aria2Files"
  | "errorMessage"
  | "repairNote"
  | "supersededById"
  | "createdAt"
>;

export type DownloadRepairSnapshot = {
  downloads: DownloadRepairRecord[];
  knownAria2: Aria2Status[];
  downloadsDir: string;
  artifacts: Map<string, DownloadRepairArtifact>;
  warnings?: string[];
};

const statusPriority: Record<DownloadStatus, number> = {
  COMPLETED: 50,
  ACTIVE: 40,
  WAITING: 30,
  PAUSED: 20,
  FAILED: 10,
};

const emptyArtifact: DownloadRepairArtifact = {
  targetState: "none",
  expectedBytes: "0",
  actualBytes: "0",
  controlFileExists: false,
  savedTorrentExists: false,
};

export async function createDownloadRepairPlan(): Promise<DownloadRepairPlan> {
  const settings = await getAppSettings();
  const downloads = await prisma.download.findMany({
    where: { supersededById: null },
    orderBy: { createdAt: "asc" },
  });
  const warnings: string[] = [];
  const knownAria2 = await listKnownDownloads().catch((error) => {
    warnings.push(
      `Unable to list aria2 tasks: ${error instanceof Error ? error.message : "Unknown aria2 error"}`,
    );
    return [];
  });
  const artifacts = new Map<string, DownloadRepairArtifact>();
  await Promise.all(
    downloads
      .filter((download) => download.status === "FAILED")
      .map(async (download) => {
        artifacts.set(
          download.id,
          await inspectDownloadRepairArtifact(download, settings.directories.downloadsDir),
        );
      }),
  );
  return buildDownloadRepairPlan({
    downloads,
    knownAria2,
    downloadsDir: settings.directories.downloadsDir,
    artifacts,
    warnings,
  });
}

export function buildDownloadRepairPlan(snapshot: DownloadRepairSnapshot): DownloadRepairPlan {
  const downloads = snapshot.downloads.filter((download) => !download.supersededById);
  const failed = downloads.filter((download) => download.status === "FAILED");
  const knownByGid = new Map(snapshot.knownAria2.map((status) => [status.gid, status]));
  const trackedByGid = new Map(
    downloads
      .filter((download) => download.aria2Gid)
      .map((download) => [download.aria2Gid as string, download]),
  );
  const sourceGroups = groupBy(
    downloads.filter((download) => download.sourceUrl.trim().length > 0),
    (download) => download.sourceUrl,
  );
  const knownByHash = groupBy(
    snapshot.knownAria2.filter((status) => normalizeBtInfoHash(status.infoHash ?? "")),
    (status) => normalizeBtInfoHash(status.infoHash ?? "") as string,
  );
  const knownByPath = new Map<string, Aria2Status[]>();
  for (const status of snapshot.knownAria2) {
    for (const file of status.files ?? []) {
      if (!file.path || file.path.startsWith("[METADATA]")) {
        continue;
      }
      const matches = knownByPath.get(file.path) ?? [];
      matches.push(status);
      knownByPath.set(file.path, matches);
    }
  }

  const items = failed.map((download) => {
    const artifact = snapshot.artifacts.get(download.id) ?? emptyArtifact;
    const current = download.aria2Gid ? knownByGid.get(download.aria2Gid) : undefined;
    if (artifact.targetState === "complete") {
      return repairItem(download, artifact, {
        kind: "mark_completed",
        confidence: "high",
        reason: "The target file exists inside DOWNLOADS_DIR and is at least the expected byte length.",
      });
    }

    if (current) {
      const followedCanonical = (current.followedBy ?? [])
        .map((gid) => trackedByGid.get(gid))
        .find((tracked) => tracked && tracked.id !== download.id);
      if (followedCanonical) {
        return repairItem(download, artifact, {
          kind: "supersede_duplicate",
          confidence: "high",
          reason: `The metadata GID follows an aria2 task tracked by canonical download ${followedCanonical.id}.`,
          canonicalDownloadId: followedCanonical.id,
        });
      }
      if (current.status === "error" || current.status === "removed") {
        if (download.repairNote?.startsWith("Controlled source retry completed")) {
          return repairItem(download, artifact, {
            kind: "manual_review",
            confidence: "low",
            executable: false,
            reason: current.errorMessage
              ? `The controlled retry remains failed in aria2: ${current.errorMessage}`
              : "The controlled retry remains failed in aria2.",
          });
        }
        return repairItem(download, artifact, {
          kind: "retry_source",
          confidence: "medium",
          reason: current.errorMessage
            ? `The current aria2 task is failed and can be recreated from its source: ${current.errorMessage}`
            : "The current aria2 task is failed and can be recreated from its source.",
        });
      }
      return repairItem(download, artifact, {
        kind: "sync_existing_gid",
        confidence: "high",
        reason: "The database GID still exists in aria2 and can be synchronized without re-adding the source.",
      });
    }

    const sourceGroup = sourceGroups.get(download.sourceUrl) ?? [download];
    const canonical = selectCanonicalDownload(sourceGroup, snapshot.artifacts);
    if (sourceGroup.length > 1 && canonical.id !== download.id) {
      return repairItem(download, artifact, {
        kind: "supersede_duplicate",
        confidence: "high",
        reason: `The same source is represented by canonical download ${canonical.id}.`,
        canonicalDownloadId: canonical.id,
      });
    }

    const infoHash =
      normalizeBtInfoHash(download.infoHash ?? "") ??
      extractBtInfoHash(download.errorMessage ?? "") ??
      extractBtInfoHash(download.sourceUrl);
    const replacements = uniqueStatuses([
      ...(infoHash ? knownByHash.get(infoHash) ?? [] : []),
      ...(download.targetPath ? knownByPath.get(download.targetPath) ?? [] : []),
    ]).filter((status) => status.gid !== download.aria2Gid);

    if (replacements.length === 1) {
      const replacement = replacements[0];
      const tracked = trackedByGid.get(replacement.gid);
      if (tracked && tracked.id !== download.id) {
        return repairItem(download, artifact, {
          kind: "supersede_duplicate",
          confidence: "high",
          reason: `aria2 GID ${replacement.gid} is already tracked by canonical download ${tracked.id}.`,
          canonicalDownloadId: tracked.id,
        });
      }
      return repairItem(download, artifact, {
        kind: "adopt_aria2_gid",
        confidence: "high",
        reason: infoHash
          ? "A single aria2 task has the same BitTorrent info hash."
          : "A single aria2 task contains the same target path.",
        replacementGid: replacement.gid,
        replacementInfoHash: normalizeBtInfoHash(replacement.infoHash ?? ""),
      });
    }

    if (replacements.length > 1) {
      return repairItem(download, artifact, {
        kind: "manual_review",
        confidence: "low",
        executable: false,
        reason: `Multiple aria2 tasks match this record (${replacements.map((item) => item.gid).join(", ")}).`,
      });
    }

    if (download.sourceUrl.trim().length > 0) {
      const resumeDetail =
        artifact.targetState === "partial"
          ? artifact.controlFileExists
            ? " A matching .aria2 control file is present."
            : " Existing bytes require BitTorrent integrity checking before resuming."
          : artifact.savedTorrentExists
            ? " Saved torrent metadata is present in DOWNLOADS_DIR."
            : " No reusable target file was confirmed, so this may restart from zero.";
      return repairItem(download, artifact, {
        kind: "retry_source",
        confidence: artifact.controlFileExists ? "high" : "medium",
        reason: `The original source is available for a controlled aria2 retry.${resumeDetail}`,
      });
    }

    return repairItem(download, artifact, {
      kind: "manual_review",
      confidence: "low",
      executable: false,
      reason: "No live aria2 task, complete target file, or source URL is available.",
    });
  });

  const itemByDownload = new Map(items.map((item) => [item.downloadId, item]));
  const itemsWithDependencies = items.map((item) => {
    if (item.kind !== "supersede_duplicate" || !item.canonicalDownloadId) {
      return item;
    }
    const dependency = itemByDownload.get(item.canonicalDownloadId);
    return dependency?.executable ? { ...item, dependsOnActionId: dependency.actionId } : item;
  });
  const planId = stableHash(
    itemsWithDependencies.map((item) => ({
      actionId: item.actionId,
      kind: item.kind,
      replacementGid: item.replacementGid,
      canonicalDownloadId: item.canonicalDownloadId,
      dependsOnActionId: item.dependsOnActionId,
      targetState: item.artifact.targetState,
      expectedBytes: item.artifact.expectedBytes,
      actualBytes: item.artifact.actualBytes,
    })),
  );
  const byKind = Object.fromEntries(
    [
      "sync_existing_gid",
      "adopt_aria2_gid",
      "mark_completed",
      "retry_source",
      "supersede_duplicate",
      "manual_review",
    ].map((kind) => [kind, itemsWithDependencies.filter((item) => item.kind === kind).length]),
  ) as Record<DownloadRepairKind, number>;

  return {
    planId,
    createdAt: new Date().toISOString(),
    downloadsDir: snapshot.downloadsDir,
    warnings: snapshot.warnings ?? [],
    summary: {
      failed: failed.length,
      knownAria2: snapshot.knownAria2.length,
      executable: itemsWithDependencies.filter((item) => item.executable).length,
      review: itemsWithDependencies.filter((item) => !item.executable).length,
      byKind,
    },
    items: itemsWithDependencies,
  };
}

export async function executeDownloadRepairPlan(input: {
  planId: string;
  actionIds: string[];
  confirmation: string;
}): Promise<DownloadRepairExecutionResult> {
  if (input.confirmation !== DOWNLOAD_REPAIR_CONFIRMATION) {
    throw new DownloadRepairValidationError("Download repair confirmation phrase does not match.");
  }
  const plan = await createDownloadRepairPlan();
  if (plan.planId !== input.planId) {
    throw new DownloadRepairPlanStaleError(
      "Download repair plan is stale. Generate a new dry-run plan before applying changes.",
    );
  }
  const selected = new Set(input.actionIds);
  if (selected.size !== input.actionIds.length) {
    throw new DownloadRepairValidationError("Download repair action IDs must be unique.");
  }
  const requestedItems = plan.items.filter((item) => selected.has(item.actionId));
  if (requestedItems.length !== selected.size) {
    throw new DownloadRepairValidationError(
      "One or more download repair action IDs are not part of the current plan.",
    );
  }
  if (requestedItems.some((item) => !item.executable)) {
    throw new DownloadRepairValidationError(
      "Manual-review download repair items cannot be executed automatically.",
    );
  }

  const ordered = [...requestedItems].sort((left, right) => {
    return Number(left.kind === "supersede_duplicate") - Number(right.kind === "supersede_duplicate");
  });
  const statusByAction = new Map<string, "succeeded" | "failed" | "skipped">();
  const results: DownloadRepairExecutionResult["results"] = [];

  for (const item of ordered) {
    if (
      item.dependsOnActionId &&
      (!selected.has(item.dependsOnActionId) || statusByAction.get(item.dependsOnActionId) !== "succeeded")
    ) {
      statusByAction.set(item.actionId, "skipped");
      results.push({
        actionId: item.actionId,
        downloadId: item.downloadId,
        kind: item.kind,
        status: "skipped",
        message: "The canonical download repair did not succeed in this execution.",
      });
      continue;
    }

    try {
      await executeDownloadRepairItem(item);
      statusByAction.set(item.actionId, "succeeded");
      results.push({
        actionId: item.actionId,
        downloadId: item.downloadId,
        kind: item.kind,
        status: "succeeded",
        message: item.reason,
      });
    } catch (error) {
      statusByAction.set(item.actionId, "failed");
      results.push({
        actionId: item.actionId,
        downloadId: item.downloadId,
        kind: item.kind,
        status: "failed",
        message: error instanceof Error ? error.message : "Unexpected download repair error",
      });
    }
  }

  return {
    planId: plan.planId,
    requested: requestedItems.length,
    succeeded: results.filter((result) => result.status === "succeeded").length,
    failed: results.filter((result) => result.status === "failed").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    results,
  };
}

async function executeDownloadRepairItem(item: DownloadRepairItem) {
  if (item.kind === "manual_review") {
    throw new Error("Manual-review items cannot be executed automatically.");
  }
  if (item.kind === "sync_existing_gid" || item.kind === "mark_completed") {
    return requireRecoveredDownload(await syncSingleAria2Download(item.downloadId));
  }
  if (item.kind === "retry_source") {
    return requireRecoveredDownload(await retryFailedDownload(item.downloadId));
  }
  if (item.kind === "adopt_aria2_gid") {
    if (!item.replacementGid) {
      throw new Error("Replacement aria2 GID is missing from the repair plan.");
    }
    const tracked = await prisma.download.findUnique({
      where: { aria2Gid: item.replacementGid },
      select: { id: true },
    });
    if (tracked && tracked.id !== item.downloadId) {
      throw new Error(`Replacement aria2 GID is now tracked by download ${tracked.id}.`);
    }
    await prisma.download.update({
      where: { id: item.downloadId },
      data: {
        aria2Gid: item.replacementGid,
        infoHash: item.replacementInfoHash ?? undefined,
        repairNote: `Adopted aria2 GID ${item.replacementGid} from repair plan.`,
      },
    });
    return requireRecoveredDownload(await syncSingleAria2Download(item.downloadId));
  }
  if (!item.canonicalDownloadId) {
    throw new Error("Canonical download ID is missing from the repair plan.");
  }
  return supersedeDuplicateDownload(item.downloadId, item.canonicalDownloadId);
}

async function supersedeDuplicateDownload(downloadId: string, canonicalDownloadId: string) {
  const [download, canonical] = await Promise.all([
    prisma.download.findUniqueOrThrow({ where: { id: downloadId } }),
    prisma.download.findUniqueOrThrow({ where: { id: canonicalDownloadId } }),
  ]);
  if (canonical.supersededById) {
    throw new Error(`Canonical download is itself superseded by ${canonical.supersededById}.`);
  }
  if (canonical.status === "FAILED") {
    throw new Error("Canonical download is still failed; duplicate was not superseded.");
  }

  return prisma.$transaction(async (transaction) => {
    await transaction.organizerPlan.updateMany({
      where: { downloadId },
      data: { downloadId: canonicalDownloadId },
    });
    if (download.candidateId) {
      await transaction.releaseCandidate.update({
        where: { id: download.candidateId },
        data: { status: canonical.status === "COMPLETED" ? "DOWNLOADED" : "SUBSCRIBED" },
      });
    }
    return transaction.download.update({
      where: { id: downloadId },
      data: {
        aria2Gid: null,
        supersededById: canonicalDownloadId,
        repairNote: `Superseded by canonical download ${canonicalDownloadId}.`,
        errorMessage: `Superseded by download ${canonicalDownloadId}.`,
        downloadSpeed: BigInt(0),
        etaSeconds: null,
        lastSyncedAt: new Date(),
      },
    });
  });
}

function requireRecoveredDownload<T extends { status: DownloadStatus; errorMessage?: string | null }>(
  download: T,
) {
  if (download.status === "FAILED") {
    throw new Error(download.errorMessage || "Download remains failed after repair action.");
  }
  return download;
}

async function inspectDownloadRepairArtifact(
  download: DownloadRepairRecord,
  downloadsDir: string,
): Promise<DownloadRepairArtifact> {
  const expectedBytes = expectedTargetBytes(download);
  const infoHash =
    normalizeBtInfoHash(download.infoHash ?? "") ?? extractBtInfoHash(download.sourceUrl);
  const savedTorrentExists = infoHash
    ? await regularFileExists(path.join(downloadsDir, `${infoHash}.torrent`), downloadsDir)
    : false;
  if (!download.targetPath) {
    return { ...emptyArtifact, expectedBytes: expectedBytes.toString(), savedTorrentExists };
  }
  const targetPath = resolveDownloadPathInsideRoot(download.targetPath, downloadsDir);
  if (!targetPath) {
    return {
      ...emptyArtifact,
      targetState: "unsafe",
      expectedBytes: expectedBytes.toString(),
      savedTorrentExists,
    };
  }
  const stat = await safeRegularFileStat(targetPath);
  const controlFileExists = await regularFileExists(`${targetPath}.aria2`, downloadsDir);
  if (!stat) {
    return {
      ...emptyArtifact,
      targetState: "missing",
      expectedBytes: expectedBytes.toString(),
      controlFileExists,
      savedTorrentExists,
    };
  }
  const actualBytes = BigInt(stat.size);
  const complete = isCompleteDownloadFileSize(actualBytes, expectedBytes);
  return {
    targetState: complete ? "complete" : "partial",
    expectedBytes: expectedBytes.toString(),
    actualBytes: actualBytes.toString(),
    controlFileExists,
    savedTorrentExists,
  };
}

function expectedTargetBytes(download: DownloadRepairRecord) {
  if (download.targetPath && Array.isArray(download.aria2Files)) {
    const target = (download.aria2Files as Array<{ path?: unknown; length?: unknown }>).find(
      (file) => file?.path === download.targetPath,
    );
    if (typeof target?.length === "string" && /^\d+$/.test(target.length)) {
      return BigInt(target.length);
    }
  }
  return download.totalBytes ?? BigInt(0);
}

function selectCanonicalDownload(
  downloads: DownloadRepairRecord[],
  artifacts: Map<string, DownloadRepairArtifact>,
) {
  return [...downloads].sort((left, right) => {
    const leftComplete = artifacts.get(left.id)?.targetState === "complete" ? 100 : 0;
    const rightComplete = artifacts.get(right.id)?.targetState === "complete" ? 100 : 0;
    const priority = rightComplete + statusPriority[right.status] - (leftComplete + statusPriority[left.status]);
    if (priority !== 0) {
      return priority;
    }
    const created = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    return created || left.id.localeCompare(right.id);
  })[0];
}

function repairItem(
  download: DownloadRepairRecord,
  artifact: DownloadRepairArtifact,
  input: Omit<
    DownloadRepairItem,
    "actionId" | "downloadId" | "title" | "currentGid" | "targetPath" | "artifact" | "executable"
  > & { executable?: boolean },
): DownloadRepairItem {
  const actionId = `${input.kind}:${stableHash({
    downloadId: download.id,
    replacementGid: input.replacementGid,
    canonicalDownloadId: input.canonicalDownloadId,
    targetState: artifact.targetState,
    expectedBytes: artifact.expectedBytes,
    actualBytes: artifact.actualBytes,
  }).slice(0, 16)}`;
  return {
    actionId,
    downloadId: download.id,
    title: download.title,
    kind: input.kind,
    confidence: input.confidence,
    executable: input.executable ?? true,
    reason: input.reason,
    currentGid: download.aria2Gid,
    replacementGid: input.replacementGid,
    replacementInfoHash: input.replacementInfoHash,
    canonicalDownloadId: input.canonicalDownloadId,
    targetPath: download.targetPath,
    artifact,
  };
}

export function resolveDownloadPathInsideRoot(candidatePath: string, rootPath: string) {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    return candidate;
  }
  return null;
}

async function safeRegularFileStat(filePath: string) {
  const stat = await fs.lstat(filePath).catch(() => null);
  return stat?.isFile() && !stat.isSymbolicLink() ? stat : null;
}

async function regularFileExists(filePath: string, rootPath: string) {
  const resolved = resolveDownloadPathInsideRoot(filePath, rootPath);
  return resolved ? Boolean(await safeRegularFileStat(resolved)) : false;
}

function uniqueStatuses(statuses: Aria2Status[]) {
  return [...new Map(statuses.map((status) => [status.gid, status])).values()];
}

function groupBy<T>(items: T[], key: (item: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const value = key(item);
    grouped.set(value, [...(grouped.get(value) ?? []), item]);
  }
  return grouped;
}

function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
