import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import {
  addMagnetToAria2,
  addTorrentToAria2,
  addTorrentUrlToAria2,
  type Aria2Status,
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

  const gid = candidate.magnetUrl
    ? await addMagnetToAria2(candidate.magnetUrl, downloadDir)
    : candidate.torrentFilePath
      ? await addTorrentToAria2(candidate.torrentFilePath, downloadDir)
      : candidate.torrentUrl
        ? await addTorrentUrlToAria2(candidate.torrentUrl, downloadDir)
      : undefined;

  if (!gid) {
    throw new Error("Candidate has no magnet URL, torrent URL, or torrent file");
  }

  const download = await prisma.download.create({
    data: {
      candidateId: candidate.id,
      aria2Gid: gid,
      sourceUrl:
        candidate.magnetUrl ??
        candidate.torrentUrl ??
        candidate.sourceUrl ??
        candidate.torrentFilePath ??
        "",
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

export async function syncAria2Downloads() {
  const downloads = await prisma.download.findMany({
    where: {
      aria2Gid: { not: null },
      OR: [
        { status: { in: ["WAITING", "ACTIVE", "PAUSED"] } },
        { status: "COMPLETED", targetPath: null },
      ],
    },
  });
  let synced = 0;

  for (const download of downloads) {
    if (!download.aria2Gid) {
      continue;
    }
    await syncSingleAria2Download(download.id).catch(() => undefined);
    synced += 1;
  }

  return { synced };
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
    return prisma.download.update({
      where: { id: download.id },
      data: {
        status: "FAILED",
        downloadSpeed: BigInt(0),
        errorMessage: `aria2 task is not available: ${
          error instanceof Error ? error.message : "Unknown aria2 error"
        }`,
        lastSyncedAt: new Date(),
      },
    });
  }

  const totalBytes = BigInt(status.totalLength ?? 0);
  const completedBytes = BigInt(status.completedLength ?? 0);
  const progress =
    totalBytes > 0 ? Number(completedBytes) / Number(totalBytes) : download.progress;
  const nextStatus = mapAria2Status(status.status);
  const targetPath = selectTargetPath(status.files) ?? download.targetPath;
  const updated = await prisma.download.update({
    where: { id: download.id },
    data: {
      aria2Gid: status.gid,
      status: nextStatus,
      totalBytes,
      completedBytes,
      downloadSpeed: BigInt(status.downloadSpeed ?? 0),
      progress,
      targetPath,
      aria2Files: (status.files ?? []) as Prisma.InputJsonValue,
      errorMessage: status.errorMessage,
      lastSyncedAt: new Date(),
    },
  });
  if (nextStatus === "COMPLETED") {
    if (download.candidateId) {
      await prisma.releaseCandidate.update({
        where: { id: download.candidateId },
        data: { status: "DOWNLOADED" },
      });
    }
    const organizerPlanCount = await prisma.organizerPlan.count({
      where: { downloadId: download.id },
    });
    if (organizerPlanCount === 0) {
      await createOrganizerPlanForDownload(download.id).catch(async (error) => {
        await prisma.download.update({
          where: { id: download.id },
          data: {
            archiveStatus: "organizer_failed",
            errorMessage: error instanceof Error ? error.message : "Organizer failed",
          },
        });
      });
    }
  }
  return updated;
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
