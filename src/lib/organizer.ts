import fs from "node:fs/promises";
import path from "node:path";
import { Prisma, type MediaType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { cacheRemoteMediaAsset, isLocalMediaAssetUrl } from "@/lib/media-assets";
import { getAppSettings } from "@/lib/settings";
import { matchMetadataForGroup, type MetadataMatch } from "@/lib/metadata";
import { normalizeTitleAliases } from "@/lib/anime-parser";
import { parseMediaReleaseTitle } from "@/lib/media-parser";
import {
  reviewOrganizerPlanWithOpenRouter,
  type OrganizerAiReview,
  type OrganizerReviewInput,
} from "@/lib/openrouter";

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
      organizerPlans: { select: { id: true, items: { select: { id: true } } } },
    },
  });
  const results = [];

  for (const download of downloads) {
    if (download.organizerPlans.some((plan) => plan.items.length > 0)) {
      continue;
    }
    results.push(await createOrganizerPlanForDownload(download.id));
  }

  return { inspected: results.length, plans: results.map((plan) => plan.id) };
}

export async function createOrganizerPlanForDownload(downloadId: string) {
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

  const sourceRoot = download.targetPath;
  if (!sourceRoot) {
    const metadata = await matchMetadataForGroup(download.candidate.groupId);
    const planMetadata = isReliableMetadataMatch(metadata)
      ? metadata
      : buildCandidateMetadataFallback({
          candidate: download.candidate,
          metadata,
        });
    return prisma.organizerPlan.create({
      data: {
        downloadId,
        candidateId: download.candidateId,
        mediaType: download.candidate.mediaType,
        status: "NEEDS_REVIEW",
        confidence: 0,
        reason: "Download has no resolved video file path",
        metadata: planMetadata as Prisma.InputJsonValue,
      },
    });
  }

  const plan = await createOrganizerPlanForCandidateSource({
    candidateId: download.candidate.id,
    downloadId,
    sourceRoot,
  });

  await prisma.download.update({
    where: { id: download.id },
    data: {
      archiveStatus: plan.status === "PENDING" ? "ready_to_archive" : "planned",
    },
  });

  return plan;
}

export async function createOrganizerPlanForCandidateSource(input: {
  candidateId: string;
  sourceRoot: string;
  downloadId?: string;
}) {
  const settings = await getAppSettings();
  const candidate = await prisma.releaseCandidate.findUniqueOrThrow({
    where: { id: input.candidateId },
    include: { group: true },
  });

  if (!candidate.groupId) {
    return prisma.organizerPlan.create({
      data: {
        downloadId: input.downloadId,
        candidateId: candidate.id,
        mediaType: candidate.mediaType,
        status: "NEEDS_REVIEW",
        confidence: 0,
        reason: "Candidate has no grouped title",
      },
    });
  }

  const metadata = await matchMetadataForGroup(candidate.groupId);
  const metadataReliable = isReliableMetadataMatch(metadata);
  const planMetadata = metadataReliable
    ? metadata
    : buildCandidateMetadataFallback({
        candidate,
        metadata,
      });
  const allowedRoots = allowedOrganizerRoots(settings.directories);
  const files = await findVideoFiles(input.sourceRoot, allowedRoots);
  if (files.length === 0) {
    return prisma.organizerPlan.create({
      data: {
        downloadId: input.downloadId,
        candidateId: candidate.id,
        mediaType: candidate.mediaType,
        status: "NEEDS_REVIEW",
        confidence: 0.2,
        reason: "No video file found",
        metadata: planMetadata as Prisma.InputJsonValue,
      },
    });
  }

  const confidence = Math.min(candidate.confidence, planMetadata.score);
  const itemInputs = await Promise.all(
    files.map(async (sourcePath) => {
      const stat = await fs.stat(sourcePath);
      const targetPath = buildTargetPath({
        mediaType: candidate.mediaType,
        roots: settings.directories,
        title: planMetadata.title || candidate.group?.displayTitle || candidate.parsedTitle,
        year: planMetadata.year,
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
  const readyForConfirmation =
    metadataReliable && confidence >= 0.82 && hasPlayableIdentity && !hasConflict;
  const status = hasConflict ? "CONFLICT" : readyForConfirmation ? "PENDING" : "NEEDS_REVIEW";
  const reason = hasConflict
    ? "Target path conflict"
    : readyForConfirmation
      ? "Ready for confirmation"
      : metadataReliable
        ? "Needs manual confirmation"
        : "Metadata needs manual confirmation";

  const plan = await prisma.organizerPlan.create({
    data: {
      downloadId: input.downloadId,
      candidateId: candidate.id,
      mediaType: candidate.mediaType,
      status,
      confidence,
      autoExecutable: false,
      reason,
      metadata: planMetadata as Prisma.InputJsonValue,
      items: {
        create: itemInputs,
      },
    },
    include: { items: true },
  });

  return plan;
}

function isReliableMetadataMatch(metadata: MetadataMatch) {
  return metadata.provider !== "fallback" && (metadata.relevance ?? 0) >= 0.82;
}

function buildCandidateMetadataFallback(input: {
  candidate: {
    parsedTitle: string;
    group: { displayTitle: string } | null;
  };
  metadata: MetadataMatch;
}): MetadataMatch {
  const title = input.candidate.group?.displayTitle || input.candidate.parsedTitle || input.metadata.title;
  return {
    provider: "fallback",
    externalId: input.metadata.externalId,
    title,
    score: Math.min(input.metadata.score, 0.72),
    relevance: 1,
    raw: {
      reason: "Provider metadata was not relevant enough to trust for organizing",
      rejectedProvider: input.metadata.provider,
      rejectedTitle: input.metadata.title,
      rejectedOriginalTitle: input.metadata.originalTitle,
      rejectedRelevance: input.metadata.relevance ?? null,
    },
  };
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

export async function cleanupPollutedOrganizerPlans() {
  const plans = await prisma.organizerPlan.findMany({
    where: {
      status: { in: ["PENDING", "NEEDS_REVIEW", "CONFLICT", "FAILED"] },
      items: { some: {} },
    },
    include: {
      items: true,
      candidate: { include: { group: true } },
    },
  });
  const polluted = plans.filter(isPollutedOrganizerPlan);
  const affectedDownloadIds = [
    ...new Set(polluted.map((plan) => plan.downloadId).filter((id): id is string => Boolean(id))),
  ];

  for (const plan of polluted) {
    await prisma.organizerPlan.delete({
      where: { id: plan.id },
    });
  }
  if (affectedDownloadIds.length > 0) {
    await prisma.download.updateMany({
      where: { id: { in: affectedDownloadIds } },
      data: { archiveStatus: null },
    });
  }

  return { inspected: plans.length, deleted: polluted.length, plans: polluted.map((plan) => plan.id) };
}

export async function reviewOrganizerPlansWithAi(limit = 30) {
  const plans = await prisma.organizerPlan.findMany({
    where: {
      status: { in: ["PENDING", "NEEDS_REVIEW", "CONFLICT"] },
      items: { some: {} },
      candidate: { isNot: null },
    },
    include: {
      items: true,
      candidate: { include: { group: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
  let reviewed = 0;
  let filteredItems = 0;
  let flagged = 0;
  let skipped = 0;

  for (const plan of plans) {
    const input = buildOrganizerReviewInput(plan);
    if (!input) {
      skipped += 1;
      continue;
    }
    const review = await reviewOrganizerPlanWithOpenRouter(input);
    if (!review) {
      skipped += 1;
      continue;
    }
    reviewed += 1;
    const result = await applyOrganizerAiReview(plan.id, review, plan.items);
    filteredItems += result.filteredItems;
    flagged += result.flagged ? 1 : 0;
  }

  return { inspected: plans.length, reviewed, filteredItems, flagged, skipped };
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

function buildOrganizerReviewInput(plan: {
  id: string;
  mediaType: MediaType;
  metadata: unknown;
  candidate: {
    mediaType: MediaType;
    parsedTitle: string;
    normalizedTitle: string;
    episodeNumber: number | null;
    season: number | null;
    group: { displayTitle: string; normalizedTitle: string; aliases: unknown } | null;
  } | null;
  items: Array<{ sourcePath: string; targetPath: string }>;
}): OrganizerReviewInput | null {
  const candidate = plan.candidate;
  if (!candidate) {
    return null;
  }
  const metadata = plan.metadata as { title?: string } | null;
  const candidateAliases = [
    candidate.parsedTitle,
    candidate.normalizedTitle,
    candidate.group?.displayTitle,
    candidate.group?.normalizedTitle,
    ...groupAliases(candidate.group?.aliases),
  ].filter((value): value is string => Boolean(value));

  return {
    planId: plan.id,
    mediaType: plan.mediaType,
    candidateTitle: candidate.group?.displayTitle || candidate.parsedTitle,
    candidateAliases,
    episodeNumber: candidate.episodeNumber,
    season: candidate.season ?? 1,
    targetTitle: metadata?.title ?? null,
    items: plan.items.map((item) => {
      const parsed = parseMediaReleaseTitle(
        path.basename(item.sourcePath, path.extname(item.sourcePath)),
        candidate.mediaType,
      );
      return {
        sourcePath: item.sourcePath,
        targetPath: item.targetPath,
        parsedTitle: parsed.parsedTitle,
        parsedEpisodeNumber: parsed.episodeNumber ?? null,
        parsedSeason: parsed.season ?? null,
      };
    }),
  };
}

export async function applyOrganizerAiReview(
  planId: string,
  review: OrganizerAiReview,
  items: Array<{ id: string; sourcePath: string }>,
) {
  const knownPaths = new Set(items.map((item) => item.sourcePath));
  const rejectedPaths = new Set(
    review.rejectedSourcePaths.filter((sourcePath) => knownPaths.has(sourcePath)),
  );
  let filteredItems = 0;
  if (review.confidence >= 0.75 && rejectedPaths.size > 0) {
    const deleted = await prisma.organizerPlanItem.deleteMany({
      where: {
        planId,
        sourcePath: { in: [...rejectedPaths] },
      },
    });
    filteredItems = deleted.count;
  }

  const remaining = items.length - filteredItems;
  const flagged = review.riskLevel !== "OK" || filteredItems > 0 || remaining === 0;
  const plan = await prisma.organizerPlan.findUnique({
    where: { id: planId },
    select: { metadata: true },
  });
  const metadata =
    plan?.metadata && typeof plan.metadata === "object" && !Array.isArray(plan.metadata)
      ? { ...(plan.metadata as Record<string, unknown>), aiReview: review }
      : { aiReview: review };
  await prisma.organizerPlan.update({
    where: { id: planId },
    data: {
      status: flagged ? "NEEDS_REVIEW" : undefined,
      reason: `AI review: ${review.summary || review.riskLevel}`,
      metadata: metadata as Prisma.InputJsonValue,
    },
  });

  return { filteredItems, flagged };
}

function isPollutedOrganizerPlan(plan: {
  downloadId?: string | null;
  items: Array<{ sourcePath: string; targetPath: string }>;
  candidate: {
    mediaType: MediaType;
    parsedTitle: string;
    normalizedTitle: string;
    group: { displayTitle: string; normalizedTitle: string; aliases: unknown } | null;
  } | null;
}) {
  if (!plan.candidate || plan.items.length === 0) {
    return false;
  }
  const candidate = plan.candidate;

  const targetPaths = plan.items.map((item) => item.targetPath).filter(Boolean);
  const hasDuplicateTargets = targetPaths.length > 1 && new Set(targetPaths).size < targetPaths.length;
  const mismatchedItems = plan.items.filter(
    (item) => !sourcePathMatchesCandidate(item.sourcePath, candidate),
  );

  return hasDuplicateTargets || mismatchedItems.length === plan.items.length;
}

function sourcePathMatchesCandidate(
  sourcePath: string,
  candidate: {
    mediaType: MediaType;
    parsedTitle: string;
    normalizedTitle: string;
    group: { displayTitle: string; normalizedTitle: string; aliases: unknown } | null;
  },
) {
  const parsed = parseMediaReleaseTitle(
    path.basename(sourcePath, path.extname(sourcePath)),
    candidate.mediaType,
  );
  if (parsed.confidence < 0.7) {
    return true;
  }
  const candidateAliases = new Set(
    [
      candidate.parsedTitle,
      candidate.normalizedTitle,
      candidate.group?.displayTitle,
      candidate.group?.normalizedTitle,
      ...groupAliases(candidate.group?.aliases),
    ].flatMap((value) => normalizeTitleAliases(value ?? "")),
  );
  const sourceAliases = [
    parsed.parsedTitle,
    parsed.normalizedTitle,
  ].flatMap((value) => normalizeTitleAliases(value ?? ""));

  return sourceAliases.some((alias) => candidateAliases.has(alias));
}

function groupAliases(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
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
  const posterUrl =
    (await cacheRemoteMediaAsset(metadata?.posterUrl, {
      mediaId: media.id,
      kind: "poster",
    })) ?? (isLocalMediaAssetUrl(metadata?.posterUrl) ? metadata?.posterUrl : undefined);
  const backdropUrl =
    (await cacheRemoteMediaAsset(metadata?.backdropUrl, {
      mediaId: media.id,
      kind: "backdrop",
    })) ?? (isLocalMediaAssetUrl(metadata?.backdropUrl) ? metadata?.backdropUrl : undefined);

  await prisma.mediaTitle.update({
    where: { id: media.id },
    data: {
      primaryTitle: title,
      originalTitle: metadata?.originalTitle,
      year: metadata?.year,
      synopsis: metadata?.synopsis,
      posterUrl,
      backdropUrl,
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
