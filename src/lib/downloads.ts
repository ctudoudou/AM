import fs from "node:fs/promises";
import { prisma } from "@/lib/db";
import { Prisma, type Download } from "@prisma/client";
import {
  addMagnetToAria2,
  addTorrentToAria2,
  addTorrentUrlToAria2,
  type Aria2Status,
  listKnownDownloads,
  mapAria2Status,
  pauseAria2Download,
  removeAria2Download,
  removeAria2DownloadResult,
  resumeAria2Download,
  tellKnownDownload,
} from "@/lib/aria2";
import { getAppSettings } from "@/lib/settings";
import { createOrganizerPlanForDownload } from "@/lib/organizer";

const videoExtensions = new Set([".mkv", ".mp4", ".avi", ".mov", ".webm", ".m4v", ".ts"]);

export async function enqueueCandidateDownload(candidateId: string) {
  const candidate = await prisma.releaseCandidate.findUniqueOrThrow({
    where: { id: candidateId },
  });
  const settings = await getAppSettings();
  const downloadDir = settings.directories.downloadsDir;

  const sourceUrl =
    candidate.magnetUrl ??
    candidate.torrentUrl ??
    candidate.sourceUrl ??
    candidate.torrentFilePath ??
    "";
  const gid = await addCandidateToAria2({
    magnetUrl: candidate.magnetUrl,
    torrentFilePath: candidate.torrentFilePath,
    torrentUrl: candidate.torrentUrl,
    sourceUrl,
    downloadDir,
  });

  if (!gid) {
    throw new Error("Candidate has no magnet URL, torrent URL, or torrent file");
  }

  const existingDownload = await prisma.download.findUnique({
    where: { aria2Gid: gid },
  });
  if (existingDownload) {
    await prisma.releaseCandidate.update({
      where: { id: candidate.id },
      data: { status: "SUBSCRIBED" },
    });
    return existingDownload;
  }

  const download = await prisma.download.create({
    data: {
      candidateId: candidate.id,
      aria2Gid: gid,
      sourceUrl,
      title: candidate.parsedTitle,
      downloadDir,
      status: "WAITING",
    },
  });

  await prisma.releaseCandidate.update({
    where: { id: candidate.id },
    data: { status: "SUBSCRIBED" },
  });

  return download;
}

async function addCandidateToAria2(input: {
  magnetUrl?: string | null;
  torrentFilePath?: string | null;
  torrentUrl?: string | null;
  sourceUrl: string;
  downloadDir: string;
}) {
  try {
    if (input.magnetUrl) {
      return await addMagnetToAria2(input.magnetUrl, input.downloadDir);
    }
    if (input.torrentFilePath) {
      return await addTorrentToAria2(input.torrentFilePath, input.downloadDir);
    }
    if (input.torrentUrl) {
      return await addTorrentUrlToAria2(input.torrentUrl, input.downloadDir);
    }
    return undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const replacement = await findReplacementAria2Status({
      sourceUrl: input.sourceUrl,
      errorMessage: message,
    });
    if (replacement) {
      return replacement.gid;
    }
    throw error;
  }
}

export async function syncAria2Downloads() {
  const downloads = await prisma.download.findMany({
    where: {
      aria2Gid: { not: null },
      OR: [
        { status: { in: ["WAITING", "ACTIVE", "PAUSED"] } },
        { status: "COMPLETED", targetPath: null },
        { status: "FAILED", errorMessage: { startsWith: "aria2 task is not available" } },
        { status: "FAILED", errorMessage: { contains: "InfoHash" } },
        { status: "FAILED", errorMessage: { contains: "already registered" } },
        { status: "FAILED", errorMessage: { contains: "control file" } },
      ],
    },
  });
  let synced = 0;
  let failed = 0;
  const errors: Array<{ id: string; message: string }> = [];

  for (const download of downloads) {
    if (!download.aria2Gid) {
      continue;
    }
    try {
      const updated = await syncSingleAria2Download(download.id);
      synced += 1;
      if (updated.status === "FAILED" && updated.errorMessage?.startsWith("aria2 task is not available")) {
        failed += 1;
        errors.push({ id: download.id, message: updated.errorMessage });
      }
    } catch (error) {
      failed += 1;
      errors.push({
        id: download.id,
        message: error instanceof Error ? error.message : "Unknown aria2 sync error",
      });
    }
  }

  return { synced, failed, errors: errors.slice(0, 5) };
}

export async function syncSingleAria2Download(downloadId: string) {
  const download = await prisma.download.findUniqueOrThrow({
    where: { id: downloadId },
  });
  if (!download.aria2Gid) {
    return prisma.download.update({
      where: { id: download.id },
      data: {
        status: "FAILED",
        errorMessage: "Download has no aria2 gid.",
        lastSyncedAt: new Date(),
      },
    });
  }

  let status: Awaited<ReturnType<typeof tellKnownDownload>>;
  try {
    status = await tellKnownDownload(download.aria2Gid);
    status = await resolveFollowedAria2Status(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown aria2 error";
    const replacement = await findReplacementAria2Status({
      sourceUrl: download.sourceUrl,
      targetPath: download.targetPath,
      errorMessage: `${download.errorMessage ?? ""} ${message}`,
      ignoredGid: download.aria2Gid,
    });
    if (replacement) {
      status = await resolveFollowedAria2Status(replacement);
    } else {
      const completed = await completeFromExistingTargetIfPossible(download, download.targetPath);
      if (completed) {
        return completed;
      }
      return prisma.download.update({
        where: { id: download.id },
        data: {
          status: "FAILED",
          downloadSpeed: BigInt(0),
          errorMessage: `aria2 task is not available: ${message}`,
          lastSyncedAt: new Date(),
        },
      });
    }
  }

  const duplicateReplacement = await findReplacementForDuplicateStatus(download, status);
  if (duplicateReplacement) {
    status = await resolveFollowedAria2Status(duplicateReplacement);
  }

  const totalBytes = BigInt(status.totalLength ?? 0);
  const completedBytes = BigInt(status.completedLength ?? 0);
  const downloadSpeed = BigInt(status.downloadSpeed ?? 0);
  const targetPath = selectTargetPath(status.files) ?? download.targetPath;
  const nextStatus = mapAria2Status(status.status);

  if (nextStatus === "FAILED") {
    const completed = await completeFromExistingTargetIfPossible(download, targetPath, totalBytes);
    if (completed) {
      return completed;
    }
  }

  const trackedDuplicate = await findTrackedDownloadForAria2Gid(download.id, status.gid);
  if (trackedDuplicate) {
    return syncFromTrackedDuplicate(download, trackedDuplicate);
  }

  const progress =
    totalBytes > 0 ? Number(completedBytes) / Number(totalBytes) : download.progress;
  const etaSeconds =
    downloadSpeed > 0 && totalBytes > completedBytes
      ? Number((totalBytes - completedBytes) / downloadSpeed)
      : null;
  const updated = await prisma.download.update({
    where: { id: download.id },
    data: {
      aria2Gid: status.gid,
      status: nextStatus,
      totalBytes,
      completedBytes,
      downloadSpeed,
      etaSeconds,
      progress,
      targetPath,
      aria2Files: (status.files ?? []) as Prisma.InputJsonValue,
      errorMessage: status.errorMessage ?? null,
      lastSyncedAt: new Date(),
    },
  });
  if (nextStatus === "COMPLETED") {
    await finalizeCompletedDownload(updated);
  }
  return updated;
}

async function findTrackedDownloadForAria2Gid(downloadId: string, aria2Gid: string) {
  const tracked = await prisma.download.findUnique({
    where: { aria2Gid },
  });
  return tracked && tracked.id !== downloadId ? tracked : null;
}

async function syncFromTrackedDuplicate(
  download: Download,
  tracked: Pick<Download, "id" | "status" | "targetPath" | "totalBytes">,
) {
  if (tracked.status === "COMPLETED" && tracked.targetPath) {
    const completed = await completeFromExistingTargetIfPossible(
      download,
      tracked.targetPath,
      tracked.totalBytes ?? BigInt(0),
    );
    if (completed) {
      return completed;
    }
  }

  return prisma.download.update({
    where: { id: download.id },
    data: {
      status: "FAILED",
      downloadSpeed: BigInt(0),
      errorMessage: `Duplicate aria2 task is already tracked by download ${tracked.id}.`,
      lastSyncedAt: new Date(),
    },
  });
}

async function findReplacementForDuplicateStatus(download: Download, status: Aria2Status) {
  if (status.status !== "error" || !isRecoverableDownloadError(status.errorMessage)) {
    return null;
  }
  return findReplacementAria2Status({
    sourceUrl: download.sourceUrl,
    targetPath: download.targetPath,
    errorMessage: status.errorMessage,
    ignoredGid: status.gid,
  });
}

async function completeFromExistingTargetIfPossible(
  download: Download,
  targetPath?: string | null,
  expectedBytes: bigint = BigInt(0),
) {
  if (!targetPath || !videoExtensions.has(extname(targetPath))) {
    return null;
  }

  const stat = await fs.stat(targetPath).catch(() => null);
  if (!stat?.isFile() || stat.size <= 0) {
    return null;
  }
  const size = BigInt(stat.size);
  if (expectedBytes > 0 && size < expectedBytes) {
    return null;
  }

  const updated = await prisma.download.update({
    where: { id: download.id },
    data: {
      status: "COMPLETED",
      progress: 1,
      targetPath,
      totalBytes: size,
      completedBytes: size,
      downloadSpeed: BigInt(0),
      etaSeconds: null,
      errorMessage: null,
      lastSyncedAt: new Date(),
    },
  });
  await finalizeCompletedDownload(updated);
  return updated;
}

async function finalizeCompletedDownload(download: Pick<Download, "id" | "candidateId">) {
  if (download.candidateId) {
    await prisma.releaseCandidate.update({
      where: { id: download.candidateId },
      data: { status: "DOWNLOADED" },
    });
  }
  const organizerPlans = await prisma.organizerPlan.findMany({
    where: { downloadId: download.id },
    select: { items: { select: { id: true } } },
  });
  if (!organizerPlans.some((plan) => plan.items.length > 0)) {
    await createOrganizerPlanForDownload(download.id).catch(async (error) => {
      return prisma.download.update({
        where: { id: download.id },
        data: {
          archiveStatus: "organizer_failed",
          errorMessage: error instanceof Error ? error.message : "Organizer failed",
        },
      });
    });
  }
}

async function findReplacementAria2Status(input: {
  sourceUrl?: string | null;
  targetPath?: string | null;
  errorMessage?: string | null;
  ignoredGid?: string | null;
}) {
  const infoHash =
    extractBtInfoHash(input.errorMessage ?? "") ??
    extractBtInfoHash(input.sourceUrl ?? "");
  const statuses = await listKnownDownloads().catch(() => []);
  const replacement = statuses.find((status) => {
    if (input.ignoredGid && status.gid === input.ignoredGid) {
      return false;
    }
    if (infoHash && normalizeBtInfoHash(status.infoHash ?? "") === infoHash) {
      return true;
    }
    if (input.targetPath && status.files?.some((file) => file.path === input.targetPath)) {
      return true;
    }
    return false;
  });
  return replacement ?? null;
}

async function resolveFollowedAria2Status(status: Aria2Status) {
  if (!isMetadataOnlyAria2Status(status)) {
    return status;
  }
  for (const gid of status.followedBy ?? []) {
    const followedStatus = await tellKnownDownload(gid).catch(() => null);
    if (followedStatus && selectTargetPath(followedStatus.files)) {
      return followedStatus;
    }
  }
  return status;
}

export function isMetadataOnlyAria2Status(status: Aria2Status) {
  return !selectTargetPath(status.files) && Boolean(status.followedBy?.length);
}

export type DownloadDiagnosticsInput = {
  aria2Gid?: string | null;
  status: string;
  progress?: number | null;
  totalBytes?: bigint | number | string | null;
  completedBytes?: bigint | number | string | null;
  downloadSpeed?: bigint | number | string | null;
  etaSeconds?: number | null;
  aria2Files?: unknown;
  targetPath?: string | null;
  errorMessage?: string | null;
  archiveStatus?: string | null;
  lastSyncedAt?: Date | string | null;
};

export type DownloadDiagnostics = {
  reason:
    | "none"
    | "no_gid"
    | "aria2_error"
    | "metadata"
    | "queued"
    | "no_peers"
    | "no_files"
    | "paused"
    | "organizer_pending";
  speedBytesPerSecond: string;
  completedBytes: string;
  totalBytes: string;
  etaSeconds: number | null;
  visibleFileCount: number;
  metadataOnly: boolean;
  lastSyncedAt: string | null;
};

export function buildDownloadDiagnostics(download: DownloadDiagnosticsInput): DownloadDiagnostics {
  const files = normalizeAria2Files(download.aria2Files);
  const visibleFiles = files.filter((file) => file.path && file.path !== "[METADATA]");
  const metadataOnly = files.length > 0 && visibleFiles.length === 0;
  const speedBytesPerSecond = bigintString(download.downloadSpeed);
  const totalBytes = bigintString(download.totalBytes);
  const completedBytes = bigintString(download.completedBytes);
  const speed = BigInt(speedBytesPerSecond);
  const total = BigInt(totalBytes);
  const completed = BigInt(completedBytes);
  const etaSeconds =
    typeof download.etaSeconds === "number"
      ? download.etaSeconds
      : speed > 0 && total > completed
        ? Number((total - completed) / speed)
        : null;

  return {
    reason: inferDownloadReason(download, {
      completed,
      metadataOnly,
      speed,
      total,
      visibleFileCount: visibleFiles.length,
    }),
    speedBytesPerSecond,
    completedBytes,
    totalBytes,
    etaSeconds,
    visibleFileCount: visibleFiles.length,
    metadataOnly,
    lastSyncedAt: download.lastSyncedAt ? new Date(download.lastSyncedAt).toISOString() : null,
  };
}

function inferDownloadReason(
  download: DownloadDiagnosticsInput,
  details: {
    completed: bigint;
    metadataOnly: boolean;
    speed: bigint;
    total: bigint;
    visibleFileCount: number;
  },
): DownloadDiagnostics["reason"] {
  if (!download.aria2Gid) {
    return "no_gid";
  }
  if (download.status === "FAILED" && download.errorMessage) {
    return "aria2_error";
  }
  if (download.status === "COMPLETED" && !download.archiveStatus) {
    return "organizer_pending";
  }
  if (download.status === "PAUSED") {
    return "paused";
  }
  if (details.metadataOnly) {
    return "metadata";
  }
  if (download.status === "WAITING") {
    return details.visibleFileCount === 0 ? "no_files" : "queued";
  }
  if (download.status === "ACTIVE" && details.speed === BigInt(0) && details.total > details.completed) {
    return "no_peers";
  }
  return "none";
}

export function isRecoverableDownloadError(value: string | null | undefined) {
  const message = value ?? "";
  return (
    message.startsWith("aria2 task is not available") ||
    /InfoHash\s+[a-z0-9]{32,40}\s+is already registered/i.test(message) ||
    /already registered/i.test(message) ||
    /control file\(\*\.aria2\) does not exist/i.test(message)
  );
}

export function extractBtInfoHash(value: string) {
  const decoded = safeDecodeURIComponent(value);
  const match =
    decoded.match(/InfoHash\s+(?<hash>[a-z2-7\d]{32,40})\s+is already registered/i) ??
    decoded.match(/(?:xt=urn:btih:|btih:)(?<hash>[a-z2-7\d]{32,40})/i);
  return normalizeBtInfoHash(match?.groups?.hash ?? "");
}

export function normalizeBtInfoHash(value: string) {
  const hash = value.trim().toLowerCase();
  if (/^[a-f0-9]{40}$/.test(hash)) {
    return hash;
  }
  if (/^[a-z2-7]{32}$/.test(hash)) {
    return base32ToHex(hash);
  }
  return null;
}

function base32ToHex(value: string) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = "";
  for (const char of value.toLowerCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) {
      return null;
    }
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = bits.match(/.{8}/g) ?? [];
  return bytes
    .slice(0, 20)
    .map((byte) => Number.parseInt(byte, 2).toString(16).padStart(2, "0"))
    .join("");
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeAria2Files(value: unknown): Array<{
  path?: string;
  length?: string;
  completedLength?: string;
  selected?: string;
}> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((file): file is { path?: string; length?: string; completedLength?: string; selected?: string } => {
    return typeof file === "object" && file !== null;
  });
}

function bigintString(value: bigint | number | string | null | undefined) {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value)).toString();
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return value;
  }
  return "0";
}

export async function controlAria2Download(
  downloadId: string,
  action: "pause" | "resume" | "remove" | "sync",
) {
  const download = await prisma.download.findUniqueOrThrow({
    where: { id: downloadId },
  });
  if (action === "sync") {
    return syncSingleAria2Download(downloadId);
  }
  if (!download.aria2Gid) {
    throw new Error("Download has no aria2 gid.");
  }

  try {
    if (action === "pause") {
      await pauseAria2Download(download.aria2Gid);
      return prisma.download.update({
        where: { id: download.id },
        data: { status: "PAUSED", downloadSpeed: BigInt(0), lastSyncedAt: new Date() },
      });
    }
    if (action === "resume") {
      await resumeAria2Download(download.aria2Gid);
      return syncSingleAria2Download(downloadId);
    }
    await removeAria2Download(download.aria2Gid).catch(async () => {
      await removeAria2DownloadResult(download.aria2Gid as string);
    });
    return prisma.download.update({
      where: { id: download.id },
      data: {
        status: "FAILED",
        downloadSpeed: BigInt(0),
        errorMessage: "Removed from aria2 by user.",
        lastSyncedAt: new Date(),
      },
    });
  } catch (error) {
    return prisma.download.update({
      where: { id: download.id },
      data: {
        status: action === "resume" ? "FAILED" : download.status,
        errorMessage: `aria2 ${action} failed: ${
          error instanceof Error ? error.message : "Unknown aria2 error"
        }`,
        lastSyncedAt: new Date(),
      },
    });
  }
}

export function selectTargetPath(
  files?: Array<{ path?: string; length?: string; completedLength?: string; selected?: string }>,
) {
  return (files ?? [])
    .filter((file) => file.path && file.path !== "[METADATA]")
    .filter((file) => videoExtensions.has(file.path ? extname(file.path) : ""))
    .sort((a, b) => Number(b.length ?? 0) - Number(a.length ?? 0))[0]?.path;
}

function extname(filePath: string) {
  const index = filePath.lastIndexOf(".");
  return index >= 0 ? filePath.slice(index).toLowerCase() : "";
}
