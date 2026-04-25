import { prisma } from "@/lib/db";
import {
  addMagnetToAria2,
  addTorrentToAria2,
  addTorrentUrlToAria2,
  mapAria2Status,
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
    data: { status: "DOWNLOADED" },
  });

  return download;
}

export async function syncAria2Downloads() {
  const downloads = await prisma.download.findMany({
    where: {
      aria2Gid: { not: null },
      status: { in: ["WAITING", "ACTIVE", "PAUSED"] },
    },
  });
  let synced = 0;

  for (const download of downloads) {
    if (!download.aria2Gid) {
      continue;
    }
    const status = await tellKnownDownload(download.aria2Gid);
    const totalBytes = BigInt(status.totalLength ?? 0);
    const completedBytes = BigInt(status.completedLength ?? 0);
    const progress =
      totalBytes > 0 ? Number(completedBytes) / Number(totalBytes) : download.progress;

    const nextStatus = mapAria2Status(status.status);
    const targetPath = selectTargetPath(status.files) ?? download.targetPath;
    await prisma.download.update({
      where: { id: download.id },
      data: {
        status: nextStatus,
        totalBytes,
        completedBytes,
        downloadSpeed: BigInt(status.downloadSpeed ?? 0),
        progress,
        targetPath,
        errorMessage: status.errorMessage,
        lastSyncedAt: new Date(),
      },
    });
    if (nextStatus === "COMPLETED") {
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
    synced += 1;
  }

  return { synced };
}

function selectTargetPath(
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
