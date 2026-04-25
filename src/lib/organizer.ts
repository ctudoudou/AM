import fs from "node:fs/promises";
import path from "node:path";
import { Prisma, type MediaType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { matchMetadataForGroup } from "@/lib/metadata";

const videoExtensions = new Set([
  ".mkv",
  ".mp4",
  ".avi",
  ".mov",
  ".webm",
  ".m4v",
  ".ts",
]);

export async function inspectCompletedDownloads() {
  const downloads = await prisma.download.findMany({
    where: {
      status: "COMPLETED",
      archiveStatus: { not: "planned" },
    },
    include: {
      candidate: { include: { group: true } },
      organizerPlans: { select: { id: true } },
    },
  });
  const results = [];

  for (const download of downloads) {
    if (download.organizerPlans.length > 0) {
      continue;
    }
    results.push(await createOrganizerPlanForDownload(download.id));
  }

  return { inspected: results.length, plans: results.map((plan) => plan.id) };
}

export async function createOrganizerPlanForDownload(downloadId: string) {
  const settings = await getAppSettings();
  const download = await prisma.download.findUniqueOrThrow({
    where: { id: downloadId },
    include: { candidate: { include: { group: true } } },
  });

  if (!download.candidate?.groupId) {
    return prisma.organizerPlan.create({
      data: {
        downloadId,
        candidateId: download.candidateId,
        mediaType: download.candidate?.mediaType ?? "ANIME",
        status: "NEEDS_REVIEW",
        confidence: 0,
        reason: "Download has no grouped candidate",
      },
    });
  }

  const metadata = await matchMetadataForGroup(download.candidate.groupId);
  const sourceRoot = download.targetPath || download.downloadDir;
  if (!sourceRoot) {
    return prisma.organizerPlan.create({
      data: {
        downloadId,
        candidateId: download.candidateId,
        mediaType: download.candidate.mediaType,
        status: "NEEDS_REVIEW",
        confidence: 0,
        reason: "Download has no completed file path",
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  const allowedRoots = allowedOrganizerRoots(settings.directories);
  const files = await findVideoFiles(sourceRoot, allowedRoots);
  if (files.length === 0) {
    return prisma.organizerPlan.create({
      data: {
        downloadId,
        candidateId: download.candidateId,
        mediaType: download.candidate.mediaType,
        status: "NEEDS_REVIEW",
        confidence: 0.2,
        reason: "No video file found",
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  const candidate = download.candidate;
  const confidence = Math.min(candidate.confidence, metadata.score);
  const itemInputs = await Promise.all(
    files.map(async (sourcePath) => {
      const stat = await fs.stat(sourcePath);
      const targetPath = buildTargetPath({
        mediaType: candidate.mediaType,
        roots: settings.directories,
        title: metadata.title || candidate.group?.displayTitle || candidate.parsedTitle,
        year: metadata.year,
        season: candidate.season ?? 1,
        episode: candidate.episodeNumber,
        episodeTitle: candidate.parsedTitle,
        group: candidate.subtitleGroup,
        resolution: candidate.resolution,
        codec: candidate.codec,
        sourcePath,
      });
      const conflict = await exists(targetPath);
      return {
        sourcePath,
        targetPath,
        originalName: path.basename(sourcePath),
        fileType: "video",
        sizeBytes: BigInt(stat.size),
        conflict,
        conflictReason: conflict ? "Target path already exists" : undefined,
      };
    }),
  );

  const hasConflict = itemInputs.some((item) => item.conflict);
  const hasPlayableIdentity =
    candidate.mediaType === "MOVIE" ||
    (candidate.episodeNumber !== null && candidate.episodeNumber !== undefined);
  const readyForConfirmation = confidence >= 0.82 && hasPlayableIdentity && !hasConflict;
  const status = hasConflict ? "CONFLICT" : readyForConfirmation ? "PENDING" : "NEEDS_REVIEW";
  const reason = hasConflict
    ? "Target path conflict"
    : readyForConfirmation
      ? "Ready for confirmation"
      : "Needs manual confirmation";

  const plan = await prisma.organizerPlan.create({
    data: {
      downloadId,
      candidateId: candidate.id,
      mediaType: candidate.mediaType,
      status,
      confidence,
      autoExecutable: false,
      reason,
      metadata: metadata as Prisma.InputJsonValue,
      items: {
        create: itemInputs,
      },
    },
    include: { items: true },
  });

  await prisma.download.update({
    where: { id: download.id },
    data: { archiveStatus: readyForConfirmation ? "ready_to_archive" : "planned" },
  });

  return plan;
}

export async function executeOrganizerPlan(planId: string, automatic = false) {
  const settings = await getAppSettings();
  const allowedRoots = allowedOrganizerRoots(settings.directories);
  const plan = await prisma.organizerPlan.findUniqueOrThrow({
    where: { id: planId },
    include: {
      items: true,
      candidate: { include: { group: true } },
      download: true,
    },
  });

  if (plan.status === "EXECUTED" || plan.status === "AUTO_ARCHIVED") {
    throw new Error("Organizer plan has already been executed.");
  }
  if (plan.status === "REJECTED") {
    throw new Error("Organizer plan has been rejected.");
  }
  if (plan.status === "FAILED") {
    throw new Error("Organizer plan is marked as failed.");
  }
  if (plan.items.some((item) => item.conflict)) {
    throw new Error("Organizer plan has file conflicts that must be resolved first.");
  }
  if (plan.items.length === 0) {
    throw new Error("Organizer plan has no files to archive");
  }

  for (const item of plan.items) {
    const sourcePath = assertInsideConfiguredRoots(item.sourcePath, allowedRoots);
    const targetPath = assertInsideConfiguredRoots(item.targetPath, allowedRoots);
    if (!(await exists(sourcePath))) {
      await prisma.organizerPlan.update({
        where: { id: plan.id },
        data: {
          status: "FAILED",
          reason: `Source file is missing: ${sourcePath}`,
        },
      });
      throw new Error(`Source file is missing: ${sourcePath}`);
    }
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    if (await exists(targetPath)) {
      throw new Error(`Target already exists: ${targetPath}`);
    }
    await fs.rename(sourcePath, targetPath);
  }

  const mediaTitle = await upsertMediaRecords(plan);

  if (plan.download) {
    await prisma.download.update({
      where: { id: plan.download.id },
      data: { archiveStatus: automatic ? "auto_archived" : "archived" },
    });
  }

  const updated = await prisma.organizerPlan.update({
    where: { id: plan.id },
    data: {
      status: automatic ? "AUTO_ARCHIVED" : "EXECUTED",
      mediaTitleId: mediaTitle.id,
      executedAt: new Date(),
    },
    include: { items: true, candidate: true, download: true, mediaTitle: true },
  });

  return updated;
}

export async function rejectOrganizerPlan(planId: string) {
  return prisma.organizerPlan.update({
    where: { id: planId },
    data: { status: "REJECTED", reason: "Rejected by user" },
  });
}

async function findVideoFiles(sourceRoot: string, allowedRoots: string[]) {
  const root = assertInsideConfiguredRoots(sourceRoot, allowedRoots);
  const stat = await fs.stat(root);
  if (stat.isFile()) {
    return videoExtensions.has(path.extname(root).toLowerCase()) ? [root] : [];
  }
  const results: string[] = [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await findVideoFiles(fullPath, allowedRoots)));
    } else if (videoExtensions.has(path.extname(entry.name).toLowerCase())) {
      results.push(fullPath);
    }
  }
  return results;
}

function buildTargetPath(input: {
  mediaType: MediaType;
  roots: {
    animeLibraryDir: string;
    moviesLibraryDir: string;
    tvLibraryDir: string;
  };
  title: string;
  year?: number;
  season: number;
  episode?: number | null;
  episodeTitle: string;
  group?: string | null;
  resolution?: string | null;
  codec?: string | null;
  sourcePath: string;
}) {
  const title = sanitizeSegment(input.title);
  const seriesDir = input.year ? `${title} (${input.year})` : title;
  const seasonDir = `Season ${String(input.season).padStart(2, "0")}`;
  const episode = input.episode
    ? `S${String(input.season).padStart(2, "0")}E${String(Math.floor(input.episode)).padStart(2, "0")}`
    : "S00E00";
  const tags = [input.group, input.resolution, input.codec]
    .filter(Boolean)
    .map((tag) => `[${sanitizeSegment(String(tag))}]`)
    .join("");
  const ext = path.extname(input.sourcePath);
  if (input.mediaType === "MOVIE") {
    const movieName = input.year ? `${title} (${input.year})` : title;
    const filename = `${movieName} ${tags}${ext}`;
    return path.join(input.roots.moviesLibraryDir, movieName, filename);
  }
  const root =
    input.mediaType === "TV" ? input.roots.tvLibraryDir : input.roots.animeLibraryDir;
  const filename = `${title} - ${episode} - ${sanitizeSegment(input.episodeTitle)} ${tags}${ext}`;
  return path.join(root, seriesDir, seasonDir, filename);
}

async function upsertMediaRecords(plan: {
  mediaTitleId: string | null;
  metadata: unknown;
  items: Array<{
    targetPath: string;
    originalName: string;
    sizeBytes: bigint | null;
  }>;
  candidate: {
    mediaType: MediaType;
    parsedTitle: string;
    season: number | null;
    episodeNumber: number | null;
    resolution: string | null;
    codec: string | null;
    subtitleGroup: string | null;
    group: { displayTitle: string } | null;
  } | null;
}) {
  const metadata = plan.metadata as {
    title?: string;
    originalTitle?: string;
    year?: number;
    synopsis?: string;
    posterUrl?: string;
    backdropUrl?: string;
  } | null;
  const candidate = plan.candidate;
  const mediaType = candidate?.mediaType ?? "ANIME";
  const title = cleanMediaTitle(
    metadata?.title || candidate?.group?.displayTitle || candidate?.parsedTitle || "Unknown",
  );
  const media =
    (plan.mediaTitleId
      ? await prisma.mediaTitle.findUnique({ where: { id: plan.mediaTitleId } })
      : null) ??
    (await prisma.mediaTitle.findFirst({
      where: {
        type: mediaType,
        primaryTitle: title,
        year: metadata?.year ?? null,
      },
    })) ??
    (await prisma.mediaTitle.create({
      data: {
        type: mediaType,
        primaryTitle: title,
        originalTitle: metadata?.originalTitle,
        year: metadata?.year,
        synopsis: metadata?.synopsis,
        posterUrl: metadata?.posterUrl,
        backdropUrl: metadata?.backdropUrl,
      },
    }));

  await prisma.mediaTitle.update({
    where: { id: media.id },
    data: {
      primaryTitle: title,
      originalTitle: metadata?.originalTitle,
      year: metadata?.year,
      synopsis: metadata?.synopsis,
      posterUrl: metadata?.posterUrl,
      backdropUrl: metadata?.backdropUrl,
    },
  });
  const seasonNumber = candidate?.season ?? 1;
  const season = await prisma.season.upsert({
    where: { mediaId_number: { mediaId: media.id, number: seasonNumber } },
    create: { mediaId: media.id, number: seasonNumber },
    update: {},
  });
  const episodeNumber =
    mediaType === "MOVIE" ? 1 : candidate?.episodeNumber ? Math.floor(candidate.episodeNumber) : 0;
  const episode = await prisma.episode.upsert({
    where: { seasonId_number: { seasonId: season.id, number: episodeNumber } },
    create: {
      seasonId: season.id,
      number: episodeNumber,
      title: candidate?.parsedTitle,
    },
    update: { title: candidate?.parsedTitle },
  });
  for (const item of plan.items) {
    const existing = await prisma.mediaFile.findFirst({
      where: { absolutePath: item.targetPath },
      select: { id: true },
    });
    const data = {
      episodeId: episode.id,
      relativePath: item.targetPath,
      absolutePath: item.targetPath,
      originalName: item.originalName,
      sizeBytes: item.sizeBytes,
      resolution: candidate?.resolution,
      sourceResolution: candidate?.resolution,
      videoCodec: candidate?.codec,
      subtitleGroup: candidate?.subtitleGroup,
    };
    if (existing) {
      await prisma.mediaFile.update({
        where: { id: existing.id },
        data,
      });
      continue;
    }
    await prisma.mediaFile.create({
      data: {
        ...data,
      },
    });
  }
  return media;
}

function cleanMediaTitle(value: string) {
  return value
    .replace(/\s*\[\s*\]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeSegment(value: string) {
  return value.replace(/[/:*?"<>|\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);
}

async function exists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function allowedOrganizerRoots(directories: {
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

function assertInsideConfiguredRoots(candidatePath: string, allowedRoots: string[]) {
  const resolved = path.resolve(candidatePath);
  const allowed = allowedRoots.some(
    (root) => resolved === root || resolved.startsWith(`${root}${path.sep}`),
  );
  if (!allowed) {
    throw new Error(`Path is outside configured Kura roots: ${candidatePath}`);
  }
  return resolved;
}
