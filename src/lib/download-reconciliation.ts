import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Prisma, type DownloadStatus, type OrganizerPlanStatus } from "@prisma/client";
import { listKnownDownloads, pauseAria2Download, type Aria2Status } from "@/lib/aria2";
import { prisma } from "@/lib/db";
import { extractBtInfoHash, normalizeBtInfoHash } from "@/lib/downloads";
import { resolveDownloadPathInsideRoot } from "@/lib/download-repair";
import { getAppSettings } from "@/lib/settings";

export type DownloadReconciliationKind =
  | "archived_active"
  | "archived_result"
  | "untracked_payload"
  | "untracked_metadata"
  | "untracked_error"
  | "ambiguous_match";

export const DOWNLOAD_RECONCILIATION_CONFIRMATION =
  "I understand this pauses verified archived aria2 tasks";

export class DownloadReconciliationPlanStaleError extends Error {}
export class DownloadReconciliationValidationError extends Error {}

export type DownloadReconciliationRecord = {
  id: string;
  aria2Gid: string | null;
  infoHash: string | null;
  status: DownloadStatus;
  sourceUrl: string;
  targetPath: string | null;
  title: string | null;
  archiveStatus: string | null;
  supersededById: string | null;
  organizerPlans: Array<{
    id: string;
    status: OrganizerPlanStatus;
    items: Array<{
      sourcePath: string;
      targetPath: string;
      sizeBytes: bigint | null;
    }>;
  }>;
};

export type LibraryTargetEvidence = {
  path: string;
  expectedBytes: string;
  actualBytes: string;
  state:
    | "complete"
    | "missing"
    | "mismatch"
    | "unknown_size"
    | "unsafe"
    | "unreadable"
    | "root_unavailable";
};

export type DownloadReconciliationItem = {
  actionId: string;
  kind: DownloadReconciliationKind;
  gid: string;
  aria2Status: Aria2Status["status"];
  title: string | null;
  downloadId: string | null;
  candidateDownloadIds: string[];
  archiveStatus: string | null;
  matchedBy: "gid" | "info_hash" | "source_path" | "info_hash_and_source_path" | "none";
  recommendedAction: "pause" | "keep_paused" | "remove_result" | "review";
  safeToPause: boolean;
  executable: false;
  reason: string;
  payloadFiles: string[];
  payloadFileCount: number;
  completedBytes: string;
  totalBytes: string;
  libraryTargets: LibraryTargetEvidence[];
};

export type DownloadReconciliationPlan = {
  planId: string;
  createdAt: string;
  warnings: string[];
  summary: {
    downloads: number;
    knownAria2: number;
    trackedAria2: number;
    untrackedAria2: number;
    anomalies: number;
    archivedActive: number;
    safePause: number;
    manualReview: number;
    byKind: Record<DownloadReconciliationKind, number>;
  };
  items: DownloadReconciliationItem[];
};

export type DownloadReconciliationExecutionResult = {
  planId: string;
  requested: number;
  succeeded: number;
  failed: number;
  results: Array<{
    actionId: string;
    downloadId: string;
    gid: string;
    status: "succeeded" | "failed";
    message: string;
  }>;
};

export type DownloadReconciliationSnapshot = {
  downloads: DownloadReconciliationRecord[];
  knownAria2: Aria2Status[];
  targetEvidence: Map<string, LibraryTargetEvidence>;
  warnings?: string[];
};

const archivedStatuses = new Set(["archived", "auto_archived"]);
const activeAria2Statuses = new Set<Aria2Status["status"]>(["active", "waiting", "paused"]);
const completedOrganizerStatuses = new Set<OrganizerPlanStatus>(["EXECUTED", "AUTO_ARCHIVED"]);
const reconciliationKinds: DownloadReconciliationKind[] = [
  "archived_active",
  "archived_result",
  "untracked_payload",
  "untracked_metadata",
  "untracked_error",
  "ambiguous_match",
];

export async function createDownloadReconciliationPlan(): Promise<DownloadReconciliationPlan> {
  const settings = await getAppSettings();
  const downloads = await prisma.download.findMany({
    where: { supersededById: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      aria2Gid: true,
      infoHash: true,
      status: true,
      sourceUrl: true,
      targetPath: true,
      title: true,
      archiveStatus: true,
      supersededById: true,
      organizerPlans: {
        where: { status: { in: ["EXECUTED", "AUTO_ARCHIVED"] } },
        orderBy: [{ executedAt: "desc" }, { createdAt: "desc" }],
        take: 1,
        select: {
          id: true,
          status: true,
          items: {
            select: { sourcePath: true, targetPath: true, sizeBytes: true },
          },
        },
      },
    },
  });
  const warnings: string[] = [];
  const knownAria2 = await listKnownDownloads().catch((error) => {
    warnings.push(
      `Unable to list aria2 tasks: ${error instanceof Error ? error.message : "Unknown aria2 error"}`,
    );
    return [];
  });
  const allowedLibraryRoots = [
    settings.directories.animeLibraryDir,
    settings.directories.moviesLibraryDir,
    settings.directories.tvLibraryDir,
  ];
  const libraryRootAvailability = new Map(
    await Promise.all(
      allowedLibraryRoots.map(async (root) => [root, await directoryExists(root)] as const),
    ),
  );
  const unavailableRoots = allowedLibraryRoots.filter(
    (root) => !libraryRootAvailability.get(root),
  );
  if (unavailableRoots.length > 0) {
    warnings.push(
      `Configured library roots are unavailable in this runtime (${unavailableRoots.join(", ")}); affected pause candidates remain review-only.`,
    );
  }
  const targetEvidence = new Map<string, LibraryTargetEvidence>();

  await Promise.all(
    downloads.flatMap((download) =>
      archivePlanItems(download).map(async (item) => {
        const key = targetEvidenceKey(item.targetPath, item.sizeBytes);
        if (!targetEvidence.has(key)) {
          targetEvidence.set(
            key,
            await inspectLibraryTarget(
              item.targetPath,
              item.sizeBytes,
              allowedLibraryRoots,
              libraryRootAvailability,
            ),
          );
        }
      }),
    ),
  );

  return buildDownloadReconciliationPlan({
    downloads,
    knownAria2,
    targetEvidence,
    warnings,
  });
}

export async function executeDownloadReconciliationPlan(input: {
  planId: string;
  actionIds: string[];
  confirmation: string;
}): Promise<DownloadReconciliationExecutionResult> {
  return executeDownloadReconciliationPlanFromSnapshot(
    await createDownloadReconciliationPlan(),
    input,
  );
}

export async function executeDownloadReconciliationPlanFromSnapshot(
  plan: DownloadReconciliationPlan,
  input: {
    planId: string;
    actionIds: string[];
    confirmation: string;
  },
): Promise<DownloadReconciliationExecutionResult> {
  if (input.confirmation !== DOWNLOAD_RECONCILIATION_CONFIRMATION) {
    throw new DownloadReconciliationValidationError(
      "Download reconciliation confirmation phrase does not match.",
    );
  }
  if (new Set(input.actionIds).size !== input.actionIds.length) {
    throw new DownloadReconciliationValidationError(
      "Download reconciliation action IDs must be unique.",
    );
  }

  if (plan.planId !== input.planId) {
    throw new DownloadReconciliationPlanStaleError(
      "Download reconciliation plan is stale. Generate a new dry-run before pausing tasks.",
    );
  }
  const selected = new Set(input.actionIds);
  const items = plan.items.filter((item) => selected.has(item.actionId));
  if (items.length !== selected.size) {
    throw new DownloadReconciliationValidationError(
      "One or more reconciliation action IDs are not part of the current plan.",
    );
  }
  if (
    items.some(
      (item) =>
        item.kind !== "archived_active" ||
        !item.safeToPause ||
        item.recommendedAction !== "pause" ||
        !item.downloadId,
    )
  ) {
    throw new DownloadReconciliationValidationError(
      "Only verified archived redownloads with a current pause recommendation can be executed.",
    );
  }

  const results: DownloadReconciliationExecutionResult["results"] = [];
  for (const item of items) {
    const downloadId = item.downloadId as string;
    const audit = await prisma.operationLog.create({
      data: {
        domain: "DOWNLOAD",
        action: "PAUSE_ARCHIVED_REDOWNLOAD",
        status: "STARTED",
        entityType: "Download",
        entityId: downloadId,
        externalId: item.gid,
        planId: plan.planId,
        details: {
          actionId: item.actionId,
          matchedBy: item.matchedBy,
          aria2Status: item.aria2Status,
          payloadFiles: item.payloadFiles,
          libraryTargets: item.libraryTargets,
        } as Prisma.InputJsonValue,
        rollbackData: {
          action: "unpause",
          gid: item.gid,
        } as Prisma.InputJsonValue,
      },
    });
    try {
      await pauseAria2Download(item.gid);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to pause aria2 task";
      await prisma.operationLog
        .update({
          where: { id: audit.id },
          data: { status: "FAILED", errorMessage: message, completedAt: new Date() },
        })
        .catch(() => null);
      results.push({
        actionId: item.actionId,
        downloadId,
        gid: item.gid,
        status: "failed",
        message,
      });
      continue;
    }

    await prisma.operationLog
      .update({
        where: { id: audit.id },
        data: { status: "SUCCEEDED", completedAt: new Date() },
      })
      .catch(() => null);
    results.push({
      actionId: item.actionId,
      downloadId,
      gid: item.gid,
      status: "succeeded",
      message: "Verified archived aria2 redownload was paused.",
    });
  }

  return {
    planId: plan.planId,
    requested: items.length,
    succeeded: results.filter((result) => result.status === "succeeded").length,
    failed: results.filter((result) => result.status === "failed").length,
    results,
  };
}

export function buildDownloadReconciliationPlan(
  snapshot: DownloadReconciliationSnapshot,
): DownloadReconciliationPlan {
  const downloads = snapshot.downloads.filter((download) => !download.supersededById);
  const directByGid = new Map(
    downloads
      .filter((download) => download.aria2Gid)
      .map((download) => [download.aria2Gid as string, download]),
  );
  const downloadsByHash = groupBy(
    downloads.filter((download) => downloadInfoHash(download)),
    (download) => downloadInfoHash(download) as string,
  );
  const downloadsBySourcePath = new Map<string, DownloadReconciliationRecord[]>();
  for (const download of downloads) {
    const sourcePaths = new Set([
      download.targetPath,
      ...archivePlanItems(download).map((item) => item.sourcePath),
    ]);
    for (const sourcePath of sourcePaths) {
      if (!sourcePath) {
        continue;
      }
      const normalized = normalizeComparablePath(sourcePath);
      downloadsBySourcePath.set(normalized, [
        ...(downloadsBySourcePath.get(normalized) ?? []),
        download,
      ]);
    }
  }

  const items = snapshot.knownAria2.flatMap((status) => {
    const direct = directByGid.get(status.gid);
    const payloadFiles = aria2PayloadFiles(status);
    const metadataOnly = isMetadataAria2Status(status, payloadFiles);
    const inferred = direct
      ? { downloads: [], matchedBy: "none" as const }
      : inferredDownloadMatches(status, payloadFiles, downloadsByHash, downloadsBySourcePath);
    const candidates = direct ? [direct] : inferred.downloads;
    const matchedBy = direct ? "gid" : inferred.matchedBy;

    if (!direct && metadataOnly) {
      return [
        reconciliationItem({
          status,
          kind: "untracked_metadata",
          candidates,
          matchedBy,
          payloadFiles,
          reason: status.followedBy?.length
            ? `Untracked BitTorrent metadata helper follows ${status.followedBy.join(", ")}.`
            : "Untracked magnet task is still waiting for BitTorrent metadata.",
        }),
      ];
    }

    if (!direct && candidates.length > 1) {
      return [
        reconciliationItem({
          status,
          kind: "ambiguous_match",
          candidates,
          matchedBy,
          payloadFiles,
          reason: `aria2 task matches multiple canonical download records (${candidates.map((item) => item.id).join(", ")}).`,
        }),
      ];
    }

    const matched = candidates[0];
    if (matched && isArchived(matched) && activeAria2Statuses.has(status.status) && payloadFiles.length > 0) {
      const libraryTargets = archiveTargetEvidence(matched, snapshot.targetEvidence);
      const safeToPause =
        libraryTargets.length > 0 &&
        libraryTargets.every((target) => target.state === "complete");
      return [
        reconciliationItem({
          status,
          kind: "archived_active",
          candidates: [matched],
          matchedBy,
          payloadFiles,
          libraryTargets,
          safeToPause,
          recommendedAction: status.status === "paused" ? "keep_paused" : safeToPause ? "pause" : "review",
          reason: safeToPause
            ? "The download is archived, but aria2 is active again; every latest library target matches the organizer byte evidence."
            : "The download is archived, but aria2 is active again; library targets are not fully verified, so it must not be stopped automatically.",
        }),
      ];
    }

    if (matched && isArchived(matched) && ["complete", "error", "removed"].includes(status.status)) {
      return [
        reconciliationItem({
          status,
          kind: "archived_result",
          candidates: [matched],
          matchedBy,
          payloadFiles,
          libraryTargets: archiveTargetEvidence(matched, snapshot.targetEvidence),
          recommendedAction: "remove_result",
          reason: "The archived download still has a terminal aria2 result that can be reviewed for result cleanup.",
        }),
      ];
    }

    if (direct) {
      return [];
    }

    const kind: DownloadReconciliationKind =
      status.status === "error" || status.status === "removed"
        ? "untracked_error"
        : "untracked_payload";
    return [
      reconciliationItem({
        status,
        kind,
        candidates,
        matchedBy,
        payloadFiles,
        reason: matched
          ? `aria2 task is not tracked by GID, but it matches canonical download ${matched.id}.`
          : kind === "untracked_error"
            ? "aria2 has an untracked failed or removed task."
            : "aria2 has a payload task that is not represented by a canonical Download GID.",
      }),
    ];
  });

  const byKind = Object.fromEntries(
    reconciliationKinds.map((kind) => [kind, items.filter((item) => item.kind === kind).length]),
  ) as Record<DownloadReconciliationKind, number>;
  const stableItems = items.map((item) => ({
    actionId: item.actionId,
    kind: item.kind,
    gid: item.gid,
    aria2Status: item.aria2Status,
    downloadId: item.downloadId,
    candidateDownloadIds: item.candidateDownloadIds,
    recommendedAction: item.recommendedAction,
    safeToPause: item.safeToPause,
    completedBytes: item.completedBytes,
    totalBytes: item.totalBytes,
    libraryTargets: item.libraryTargets,
  }));

  return {
    planId: stableHash(stableItems),
    createdAt: new Date().toISOString(),
    warnings: snapshot.warnings ?? [],
    summary: {
      downloads: downloads.length,
      knownAria2: snapshot.knownAria2.length,
      trackedAria2: snapshot.knownAria2.filter((status) => directByGid.has(status.gid)).length,
      untrackedAria2: snapshot.knownAria2.filter((status) => !directByGid.has(status.gid)).length,
      anomalies: items.length,
      archivedActive: byKind.archived_active,
      safePause: items.filter((item) => item.safeToPause).length,
      manualReview: items.filter((item) => !item.safeToPause).length,
      byKind,
    },
    items,
  };
}

function inferredDownloadMatches(
  status: Aria2Status,
  payloadFiles: string[],
  downloadsByHash: Map<string, DownloadReconciliationRecord[]>,
  downloadsBySourcePath: Map<string, DownloadReconciliationRecord[]>,
) {
  const hash = normalizeBtInfoHash(status.infoHash ?? "");
  const hashMatches = hash ? downloadsByHash.get(hash) ?? [] : [];
  const pathMatches = payloadFiles.flatMap(
    (filePath) => downloadsBySourcePath.get(normalizeComparablePath(filePath)) ?? [],
  );
  const downloads = uniqueDownloads([...hashMatches, ...pathMatches]);
  const matchedBy =
    hashMatches.length > 0 && pathMatches.length > 0
      ? "info_hash_and_source_path"
      : hashMatches.length > 0
        ? "info_hash"
        : pathMatches.length > 0
          ? "source_path"
          : "none";
  return { downloads, matchedBy } as const;
}

function reconciliationItem(input: {
  status: Aria2Status;
  kind: DownloadReconciliationKind;
  candidates: DownloadReconciliationRecord[];
  matchedBy: DownloadReconciliationItem["matchedBy"];
  payloadFiles: string[];
  reason: string;
  recommendedAction?: DownloadReconciliationItem["recommendedAction"];
  safeToPause?: boolean;
  libraryTargets?: LibraryTargetEvidence[];
}): DownloadReconciliationItem {
  const matched = input.candidates.length === 1 ? input.candidates[0] : null;
  const libraryTargets = input.libraryTargets ?? [];
  const actionId = `${input.kind}:${stableHash({
    gid: input.status.gid,
    downloadIds: input.candidates.map((candidate) => candidate.id),
    aria2Status: input.status.status,
    completedLength: input.status.completedLength,
    totalLength: input.status.totalLength,
    libraryTargets,
  }).slice(0, 16)}`;
  return {
    actionId,
    kind: input.kind,
    gid: input.status.gid,
    aria2Status: input.status.status,
    title: matched?.title ?? aria2Title(input.status, input.payloadFiles),
    downloadId: matched?.id ?? null,
    candidateDownloadIds: input.candidates.map((candidate) => candidate.id),
    archiveStatus: matched?.archiveStatus ?? null,
    matchedBy: input.matchedBy,
    recommendedAction: input.recommendedAction ?? "review",
    safeToPause: input.safeToPause ?? false,
    executable: false,
    reason: input.reason,
    payloadFiles: input.payloadFiles.slice(0, 5),
    payloadFileCount: input.payloadFiles.length,
    completedBytes: numericString(input.status.completedLength),
    totalBytes: numericString(input.status.totalLength),
    libraryTargets,
  };
}

function archiveTargetEvidence(
  download: DownloadReconciliationRecord,
  evidence: Map<string, LibraryTargetEvidence>,
) {
  return archivePlanItems(download).map((item) => {
    return (
      evidence.get(targetEvidenceKey(item.targetPath, item.sizeBytes)) ?? {
        path: item.targetPath,
        expectedBytes: item.sizeBytes?.toString() ?? "0",
        actualBytes: "0",
        state: "unreadable" as const,
      }
    );
  });
}

function archivePlanItems(download: DownloadReconciliationRecord) {
  const plan = download.organizerPlans.find((item) => completedOrganizerStatuses.has(item.status));
  return plan?.items ?? [];
}

async function inspectLibraryTarget(
  targetPath: string,
  expectedBytes: bigint | null,
  allowedRoots: string[],
  rootAvailability: Map<string, boolean>,
): Promise<LibraryTargetEvidence> {
  const expected = expectedBytes ?? BigInt(0);
  const matchingRoot = allowedRoots.find((root) =>
    Boolean(resolveDownloadPathInsideRoot(targetPath, root)),
  );
  if (!matchingRoot) {
    return evidence(targetPath, expected, BigInt(0), "unsafe");
  }
  if (!rootAvailability.get(matchingRoot)) {
    return evidence(targetPath, expected, BigInt(0), "root_unavailable");
  }
  const safePath = resolveDownloadPathInsideRoot(targetPath, matchingRoot);
  if (!safePath) {
    return evidence(targetPath, expected, BigInt(0), "unsafe");
  }
  let stat;
  try {
    stat = await fs.lstat(safePath);
  } catch (error) {
    if (isMissingPathError(error)) {
      return evidence(targetPath, expected, BigInt(0), "missing");
    }
    return evidence(targetPath, expected, BigInt(0), "unreadable");
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    return evidence(targetPath, expected, BigInt(0), "unsafe");
  }
  const actual = BigInt(stat.size);
  if (expected <= BigInt(0)) {
    return evidence(targetPath, expected, actual, "unknown_size");
  }
  return evidence(targetPath, expected, actual, actual === expected ? "complete" : "mismatch");
}

function evidence(
  targetPath: string,
  expectedBytes: bigint,
  actualBytes: bigint,
  state: LibraryTargetEvidence["state"],
): LibraryTargetEvidence {
  return {
    path: targetPath,
    expectedBytes: expectedBytes.toString(),
    actualBytes: actualBytes.toString(),
    state,
  };
}

function targetEvidenceKey(targetPath: string, expectedBytes: bigint | null) {
  return `${normalizeComparablePath(targetPath)}\u0000${expectedBytes?.toString() ?? "0"}`;
}

function downloadInfoHash(download: DownloadReconciliationRecord) {
  return (
    normalizeBtInfoHash(download.infoHash ?? "") ?? extractBtInfoHash(download.sourceUrl)
  );
}

function aria2PayloadFiles(status: Aria2Status) {
  return (status.files ?? [])
    .filter((file) => file.selected !== "false")
    .map((file) => file.path?.trim() ?? "")
    .filter((filePath) => filePath.length > 0 && !isMetadataPath(filePath));
}

function isMetadataAria2Status(status: Aria2Status, payloadFiles: string[]) {
  if (payloadFiles.length > 0) {
    return false;
  }
  const files = status.files ?? [];
  return (
    files.some((file) => isMetadataPath(file.path ?? "")) ||
    Boolean(status.followedBy?.length || status.following) ||
    (numericString(status.totalLength) === "0" && Boolean(status.infoHash))
  );
}

function isMetadataPath(filePath: string) {
  return filePath.startsWith("[METADATA]");
}

function isArchived(download: DownloadReconciliationRecord) {
  return Boolean(download.archiveStatus && archivedStatuses.has(download.archiveStatus));
}

function aria2Title(status: Aria2Status, payloadFiles: string[]) {
  return status.bittorrent?.info?.name ??
    (payloadFiles[0] ? path.basename(payloadFiles[0]) : null);
}

function normalizeComparablePath(filePath: string) {
  return path.normalize(filePath);
}

function uniqueDownloads(downloads: DownloadReconciliationRecord[]) {
  return [...new Map(downloads.map((download) => [download.id, download])).values()];
}

function groupBy<T>(items: T[], key: (item: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const value = key(item);
    grouped.set(value, [...(grouped.get(value) ?? []), item]);
  }
  return grouped;
}

function numericString(value: string | undefined) {
  return value && /^\d+$/.test(value) ? value : "0";
}

function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isMissingPathError(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

async function directoryExists(directoryPath: string) {
  const stat = await fs.lstat(directoryPath).catch(() => null);
  return Boolean(stat?.isDirectory() && !stat.isSymbolicLink());
}
