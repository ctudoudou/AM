import fs from "node:fs/promises";
import path from "node:path";
import { Prisma, type MediaType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { cacheRemoteMediaAsset, isLocalMediaAssetUrl } from "@/lib/media-assets";
import { getAppSettings } from "@/lib/settings";
import { matchMetadataForGroup, type MetadataMatch } from "@/lib/metadata";
import { addMediaTitleAliases, findExistingMediaTitle } from "@/lib/media-title-repair";
import { hasBatchEpisodeRange, normalizeTitleAliases } from "@/lib/anime-parser";
import {
  normalizeCandidateEpisodeNumber,
  parseTargetPathEpisodeIdentity,
} from "@/lib/episode-normalizer";
import { parseMediaReleaseTitle } from "@/lib/media-parser";
import { aliasesFromMetadataRaw } from "@/lib/title-display";
import {
  reviewOrganizerPlanWithOpenRouter,
  type OrganizerAiReview,
  type OrganizerReviewInput,
} from "@/lib/openrouter";
import {
  moveOrganizerFiles,
  OrganizerMoveError,
  prepareOrganizerAria2Task,
  restoreOrganizerAria2Task,
  rollbackOrganizerFiles,
  type OrganizerAria2Guard,
  type OrganizerMove,
  type OrganizerRollbackResult,
} from "@/lib/organizer-lifecycle";
import { createOrganizerPlanVersion } from "@/lib/organizer-plan-version";

const videoExtensions = new Set([
  ".mkv",
  ".mp4",
  ".avi",
  ".mov",
  ".webm",
  ".m4v",
  ".ts",
]);
const audioExtensions = new Set([
  ".flac",
  ".mp3",
  ".m4a",
  ".aac",
  ".wav",
  ".ape",
  ".opus",
]);
const imageExtensions = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".avif",
]);
const metadataFileExtensions = new Set([
  ".cue",
  ".log",
  ".nfo",
  ".txt",
  ".m3u",
  ".m3u8",
]);
const minAutoOrganizerConfidence = 0.9;

type OrganizerFileType = "video" | "audio" | "image" | "metadata";

type OrganizerSourceFile = {
  sourcePath: string;
  fileType: OrganizerFileType;
};

type OrganizerAutomationAssessment = {
  executable: boolean;
  autoExecutable: boolean;
  reasons: string[];
};

export class OrganizerPlanStaleError extends Error {}
export class OrganizerExecutionBusyError extends Error {}

type OrganizerCandidateIdentity = {
  mediaType: MediaType;
  parsedTitle: string;
  normalizedTitle: string;
  episodeNumber: number | null;
  season: number | null;
  group: { displayTitle: string; normalizedTitle: string; aliases: unknown } | null;
};

export async function inspectCompletedDownloads() {
  const downloads = await prisma.download.findMany({
    where: {
      status: "COMPLETED",
      supersededById: null,
      OR: [
        { archiveStatus: null },
        { archiveStatus: { not: "planned" } },
        {
          organizerPlans: {
            some: { status: "REJECTED" },
            every: { status: "REJECTED" },
          },
        },
      ],
    },
    include: {
      candidate: { include: { group: true } },
      organizerPlans: {
        select: { id: true, status: true, resolvedAt: true, items: { select: { id: true } } },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  const nullArchiveSourceUrls = [
    ...new Set(
      downloads
        .filter((download) => download.archiveStatus === null && download.sourceUrl.length > 0)
        .map((download) => download.sourceUrl),
    ),
  ];
  const archivedPeers = nullArchiveSourceUrls.length
    ? await prisma.download.findMany({
        where: {
          sourceUrl: { in: nullArchiveSourceUrls },
          status: "COMPLETED",
          archiveStatus: { in: ["archived", "auto_archived"] },
          supersededById: null,
        },
        select: { id: true, sourceUrl: true },
      })
    : [];
  const archivedPeerBySource = new Map(
    archivedPeers.map((download) => [download.sourceUrl, download.id]),
  );
  const inspectedNullSources = new Set<string>();
  const results = [];
  const failures = [];
  const skipped: Array<{ downloadId: string; reason: string; canonicalDownloadId?: string }> = [];

  for (const download of downloads) {
    if (
      hasBlockingOrganizerPlan(download.organizerPlans) ||
      hasUnresolvedOrganizerReviewPlan(download.organizerPlans)
    ) {
      continue;
    }
    if (download.archiveStatus === null) {
      const archivedPeerId = archivedPeerBySource.get(download.sourceUrl);
      if (archivedPeerId) {
        skipped.push({
          downloadId: download.id,
          canonicalDownloadId: archivedPeerId,
          reason: "completed_source_already_archived",
        });
        continue;
      }
      if (download.sourceUrl && inspectedNullSources.has(download.sourceUrl)) {
        skipped.push({
          downloadId: download.id,
          reason: "duplicate_completed_source",
        });
        continue;
      }
      if (!download.targetPath || !(await organizerSourceExists(download.targetPath))) {
        skipped.push({
          downloadId: download.id,
          reason: "completed_source_missing",
        });
        continue;
      }
      if (download.sourceUrl) {
        inspectedNullSources.add(download.sourceUrl);
      }
    }
    try {
      results.push(await createOrganizerPlanForDownload(download.id));
    } catch (error) {
      const failure = await recordOrganizerInspectionFailure(download, error);
      failures.push(failure);
    }
  }

  return {
    inspected: results.length,
    failed: failures.length,
    skipped: skipped.length,
    plans: results.map((plan) => plan.id),
    failures,
    skippedDownloads: skipped,
  };
}

async function organizerSourceExists(sourcePath: string) {
  return Boolean(await fs.stat(sourcePath).catch(() => null));
}

async function recordOrganizerInspectionFailure(
  download: {
    id: string;
    candidateId: string | null;
    targetPath: string | null;
    candidate: { mediaType: MediaType } | null;
  },
  error: unknown,
) {
  const message = error instanceof Error ? error.message : "Organizer inspection failed";
  const plan = await prisma.organizerPlan.create({
    data: {
      downloadId: download.id,
      candidateId: download.candidateId,
      mediaType: download.candidate?.mediaType ?? "ANIME",
      status: "FAILED",
      confidence: 0,
      reason: `Organizer inspection failed: ${message}`,
      items: download.targetPath
        ? {
            create: [
              {
                sourcePath: download.targetPath,
                targetPath: download.targetPath,
                originalName: path.basename(download.targetPath),
                fileType: "video",
                sizeBytes: BigInt(0),
                conflict: true,
                conflictReason: "Source file is missing or unreadable",
              },
            ],
          }
        : undefined,
    },
  });
  await prisma.download.update({
    where: { id: download.id },
    data: {
      archiveStatus: "organizer_failed",
      errorMessage: message,
    },
  });
  return { downloadId: download.id, planId: plan.id, message };
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
    sourcePaths: selectedAria2SourcePaths(download.aria2Files),
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
  sourcePaths?: string[];
}) {
  const settings = await getAppSettings();
  const candidate = await prisma.releaseCandidate.findUniqueOrThrow({
    where: { id: input.candidateId },
    include: { group: true },
  });
  const siblingCandidates = await prisma.releaseCandidate.findMany({
    where: {
      mediaType: candidate.mediaType,
      normalizedTitle: candidate.normalizedTitle,
      season: candidate.season,
      groupId: candidate.groupId,
    },
    select: {
      id: true,
      rawTitle: true,
      parsedTitle: true,
      normalizedTitle: true,
      season: true,
      episodeNumber: true,
    },
  });
  const normalizedCandidateEpisode = normalizeCandidateEpisodeNumber(candidate, siblingCandidates);
  const parsedCandidate = candidate.rawTitle
    ? parseMediaReleaseTitle(candidate.rawTitle, candidate.mediaType)
    : null;
  const isBatchCandidate =
    candidate.mediaType === "ANIME" &&
    Boolean(parsedCandidate && hasBatchEpisodeRange(candidate.rawTitle));
  const organizerCandidate = {
    ...candidate,
    parsedTitle: isBatchCandidate && parsedCandidate ? parsedCandidate.parsedTitle : candidate.parsedTitle,
    normalizedTitle:
      isBatchCandidate && parsedCandidate ? parsedCandidate.normalizedTitle : candidate.normalizedTitle,
    season: isBatchCandidate
      ? parsedCandidate?.season ?? normalizedCandidateEpisode.season
      : normalizedCandidateEpisode.season,
    episodeNumber: isBatchCandidate ? null : normalizedCandidateEpisode.episodeNumber,
    group:
      isBatchCandidate && candidate.group
        ? {
            ...candidate.group,
            displayTitle: hasBatchEpisodeRange(candidate.group.displayTitle) && parsedCandidate
              ? parsedCandidate.parsedTitle
              : candidate.group.displayTitle,
            normalizedTitle: hasBatchEpisodeRange(candidate.group.displayTitle) && parsedCandidate
              ? parsedCandidate.normalizedTitle
              : candidate.group.normalizedTitle,
          }
        : candidate.group,
  };

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
        candidate: organizerCandidate,
        metadata,
      });
  const allowedRoots = allowedOrganizerRoots(settings.directories);
  const files = await findOrganizerFiles({
    sourceRoot: input.sourceRoot,
    allowedRoots,
    sourcePaths: input.sourcePaths,
  });
  if (files.length === 0) {
    return prisma.organizerPlan.create({
      data: {
        downloadId: input.downloadId,
        candidateId: candidate.id,
        mediaType: candidate.mediaType,
        status: "NEEDS_REVIEW",
        confidence: 0.2,
        reason: "No supported media or extra file found",
        metadata: planMetadata as Prisma.InputJsonValue,
      },
    });
  }
  const videoFiles = files.filter((file) => file.fileType === "video").map((file) => file.sourcePath);
  if (videoFiles.length === 0) {
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
  const mediaType = resolveOrganizerMediaType({
    candidate: organizerCandidate,
    sourceRoot: input.sourceRoot,
    files: videoFiles,
  });
  const effectiveCandidate = {
    ...organizerCandidate,
    mediaType,
    episodeNumber: mediaType === "MOVIE" ? 1 : organizerCandidate.episodeNumber,
    season: mediaType === "MOVIE" ? 1 : organizerCandidate.season,
  };
  const preferSourceEpisode = shouldPreferSourceEpisodeForPackage(
    videoFiles,
    effectiveCandidate,
  );

  const confidence = Math.min(candidate.confidence, planMetadata.score);
  const mainSourcePath = path.resolve(input.sourceRoot);
  const sourcePackageRoot = resolveOrganizerSourcePackageRoot({
    sourceRoot: input.sourceRoot,
    sourcePaths: files.map((file) => file.sourcePath),
  });
  const plannedItems = await Promise.all(
    files.map(async (file) => {
      const sourcePath = file.sourcePath;
      const stat = await fs.stat(sourcePath);
      const identity = resolveOrganizerItemIdentity({
        candidate: effectiveCandidate,
        sourcePath,
        preferSourceEpisode,
      });
      const matchesCandidate =
        file.fileType === "video" ? sourcePathMatchesCandidate(sourcePath, effectiveCandidate) : false;
      const archiveAsVideo =
        file.fileType === "video" &&
        (effectiveCandidate.mediaType === "MOVIE"
          ? path.resolve(sourcePath) === mainSourcePath
          : identity.episodeNumber !== null && matchesCandidate);
      const title =
        planMetadata.title ||
        effectiveCandidate.group?.displayTitle ||
        effectiveCandidate.parsedTitle;
      const targetPath = archiveAsVideo
        ? buildOrganizerTargetPath({
            mediaType: effectiveCandidate.mediaType,
            roots: settings.directories,
            title,
            year: planMetadata.year,
            season: identity.season,
            episode: identity.episodeNumber,
            episodeTitle: identity.episodeTitle,
            group: effectiveCandidate.subtitleGroup,
            resolution: effectiveCandidate.resolution,
            codec: effectiveCandidate.codec,
            sourcePath,
            titleAliases: [
              planMetadata.title,
              effectiveCandidate.group?.displayTitle,
              effectiveCandidate.group?.normalizedTitle,
              effectiveCandidate.parsedTitle,
              effectiveCandidate.normalizedTitle,
              ...groupAliases(effectiveCandidate.group?.aliases),
            ].filter((value): value is string => Boolean(value)),
          })
        : buildOrganizerExtraTargetPath({
            mediaType: effectiveCandidate.mediaType,
            roots: settings.directories,
            title,
            year: planMetadata.year,
            season: identity.season,
            sourcePath,
            sourcePackageRoot,
          });
      const conflict = await exists(targetPath);
      return {
        archiveAsVideo,
        hasPlayableIdentity: archiveAsVideo ? identity.episodeNumber !== null : true,
        sourceMatchesCandidate: archiveAsVideo ? matchesCandidate : true,
        item: {
          sourcePath,
          targetPath,
          originalName: path.basename(sourcePath),
          fileType: archiveAsVideo ? "video" : `extra_${file.fileType}`,
          sizeBytes: BigInt(stat.size),
          conflict,
          conflictReason: conflict ? "Target path already exists" : undefined,
        },
      };
    }),
  );
  const itemInputs = plannedItems.map((plannedItem) => plannedItem.item);
  markDuplicateTargetConflicts(itemInputs);

  const hasConflict = itemInputs.some((item) => item.conflict);
  const hasPlayableIdentity =
    effectiveCandidate.mediaType === "MOVIE"
      ? plannedItems.some((item) => item.archiveAsVideo)
      : plannedItems.some((item) => item.archiveAsVideo) &&
        plannedItems.every((item) => item.hasPlayableIdentity);
  const readyForConfirmation =
    metadataReliable && confidence >= 0.82 && hasPlayableIdentity && !hasConflict;
  const readyForAutoExecution =
    readyForConfirmation &&
    confidence >= minAutoOrganizerConfidence &&
    plannedItems.every((item) => item.sourceMatchesCandidate);
  const status = hasConflict ? "CONFLICT" : readyForConfirmation ? "PENDING" : "NEEDS_REVIEW";
  const reason = hasConflict
    ? "Target path conflict"
    : readyForAutoExecution
      ? "Ready for automatic archive"
      : readyForConfirmation
        ? "Ready for confirmation"
      : metadataReliable
        ? "Needs manual confirmation"
        : "Metadata needs manual confirmation";

  const plan = await prisma.organizerPlan.create({
    data: {
      downloadId: input.downloadId,
      candidateId: candidate.id,
      mediaType: effectiveCandidate.mediaType,
      status,
      confidence,
      autoExecutable: readyForAutoExecution,
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

export function hasBlockingOrganizerPlan(plans: Array<{ status: string; items: Array<unknown> }>) {
  return plans.some((plan) => plan.status !== "REJECTED" && plan.items.length > 0);
}

export function hasUnresolvedOrganizerReviewPlan(
  plans: Array<{ status: string; resolvedAt?: Date | string | null }>,
) {
  return plans.some((plan) => plan.status === "NEEDS_REVIEW" && !plan.resolvedAt);
}

function markDuplicateTargetConflicts(
  items: Array<{ targetPath: string; conflict: boolean; conflictReason?: string | null }>,
) {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.targetPath, (counts.get(item.targetPath) ?? 0) + 1);
  }
  for (const item of items) {
    if ((counts.get(item.targetPath) ?? 0) <= 1) {
      continue;
    }
    item.conflict = true;
    item.conflictReason = item.conflictReason ?? "Duplicate target path in organizer plan";
  }
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

export async function executeOrganizerPlan(
  planId: string,
  automatic = false,
  expectedVersion?: string,
) {
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

  if (!automatic) {
    const currentVersion = createOrganizerPlanVersion(plan);
    if (!expectedVersion || currentVersion !== expectedVersion) {
      throw new OrganizerPlanStaleError(
        "Organizer plan changed after it was reviewed. Reload and verify the paths again.",
      );
    }
  }
  if (plan.status === "EXECUTED" || plan.status === "AUTO_ARCHIVED") {
    throw new Error("Organizer plan has already been executed.");
  }
  if (plan.status === "EXECUTING") {
    throw new OrganizerExecutionBusyError("Organizer plan execution is already in progress.");
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

  const moves: OrganizerMove[] = [];
  for (const item of plan.items) {
    const sourcePath = assertInsideConfiguredRoots(item.sourcePath, allowedRoots);
    const targetPath = assertInsideConfiguredRoots(item.targetPath, allowedRoots);
    const integrityIssue = organizerItemIntegrityIssue({
      mediaType: plan.mediaType,
      fileType: item.fileType,
      sourcePath,
      targetPath,
    });
    if (integrityIssue) {
      await prisma.organizerPlan.update({
        where: { id: plan.id },
        data: {
          status: "NEEDS_REVIEW",
          autoExecutable: false,
          reason: integrityIssue,
        },
      });
      throw new Error(integrityIssue);
    }
    if (plan.mediaType !== "MOVIE" && item.fileType === "video" && !parseTargetPathEpisodeIdentity(targetPath)) {
      await prisma.organizerPlan.update({
        where: { id: plan.id },
        data: {
          status: "NEEDS_REVIEW",
          reason: "Organizer plan has unresolved episode identity.",
        },
      });
      throw new Error("Organizer plan has unresolved episode identity.");
    }
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
    if (await exists(targetPath)) {
      throw new Error(`Target already exists: ${targetPath}`);
    }
    moves.push({ sourcePath, targetPath });
  }

  const lease = await prisma.organizerPlan.updateMany({
    where: {
      id: plan.id,
      status: plan.status,
      updatedAt: plan.updatedAt,
    },
    data: {
      status: "EXECUTING",
      reason: automatic
        ? "Automatic organizer execution in progress."
        : "Organizer execution in progress.",
    },
  });
  if (lease.count !== 1) {
    throw new OrganizerExecutionBusyError(
      "Organizer plan changed or another execution already started. Reload before retrying.",
    );
  }

  let operation: Awaited<ReturnType<typeof prisma.operationLog.create>> | null = null;
  let aria2Guard: OrganizerAria2Guard | null = null;
  let moved: OrganizerMove[] = [];

  try {
    operation = await prisma.operationLog.create({
      data: {
        domain: "ORGANIZER",
        action: "EXECUTE_MOVE",
        status: "STARTED",
        entityType: "OrganizerPlan",
        entityId: plan.id,
        externalId: plan.download?.aria2Gid ?? null,
        planId: plan.id,
        details: {
          automatic,
          downloadId: plan.downloadId,
          moves,
        } as Prisma.InputJsonValue,
        rollbackData: {
          moves: moves.map((move) => ({
            sourcePath: move.targetPath,
            targetPath: move.sourcePath,
          })),
        } as Prisma.InputJsonValue,
      },
    });
    aria2Guard = await prepareOrganizerAria2Task(plan.download?.aria2Gid);
    moved = await moveOrganizerFiles(moves, allowedRoots);

    const operationId = operation.id;
    const completedAt = new Date();
    const updated = await prisma.$transaction(
      async (database) => {
        const mediaTitle = await upsertMediaRecords(plan, database);
        if (plan.download) {
          await database.download.update({
            where: { id: plan.download.id },
            data: { archiveStatus: automatic ? "auto_archived" : "archived" },
          });
        }
        const executedPlan = await database.organizerPlan.update({
          where: { id: plan.id },
          data: {
            status: automatic ? "AUTO_ARCHIVED" : "EXECUTED",
            mediaTitleId: mediaTitle.id,
            executedAt: completedAt,
          },
          include: { items: true, candidate: true, download: true, mediaTitle: true },
        });
        await database.operationLog.update({
          where: { id: operationId },
          data: {
            status: "SUCCEEDED",
            completedAt,
            rollbackData: {
              moves: moves.map((move) => ({
                sourcePath: move.targetPath,
                targetPath: move.sourcePath,
              })),
              aria2: aria2Guard?.pausedByOrganizer
                ? { action: "unpause", gid: aria2Guard.gid }
                : null,
            } as Prisma.InputJsonValue,
          },
        });
        return executedPlan;
      },
      { maxWait: 5_000, timeout: 30_000 },
    );
    await cacheOrganizerMediaArtwork(updated.mediaTitleId, plan.metadata).catch(() => null);

    return updated;
  } catch (error) {
    const rollback =
      error instanceof OrganizerMoveError
        ? error.rollback
        : moved.length > 0
          ? await rollbackOrganizerFiles(moved, allowedRoots)
          : emptyOrganizerRollback();
    let aria2Restored = false;
    let aria2RestoreError: string | null = null;
    try {
      aria2Restored = await restoreOrganizerAria2Task(aria2Guard);
    } catch (restoreError) {
      aria2RestoreError =
        restoreError instanceof Error ? restoreError.message : "Unable to restore aria2 task";
    }
    const message = error instanceof Error ? error.message : "Organizer execution failed";
    await prisma.organizerPlan
      .updateMany({
        where: { id: plan.id, status: "EXECUTING" },
        data: {
          status: "FAILED",
          autoExecutable: false,
          reason: message,
        },
      })
      .catch(() => null);
    if (operation) {
      await prisma.operationLog
        .update({
          where: { id: operation.id },
          data: {
            status: "FAILED",
            errorMessage: message,
            completedAt: new Date(),
            rollbackData: {
              rollback,
              aria2Restored,
              aria2RestoreError,
            } as Prisma.InputJsonValue,
          },
        })
        .catch(() => null);
    }
    throw error;
  }
}

function emptyOrganizerRollback(): OrganizerRollbackResult {
  return { restored: [], skipped: [], errors: [] };
}

export function isAutoExecutableOrganizerPlan(plan: {
  status: string;
  confidence: number;
  autoExecutable: boolean;
  candidate?: {
    mediaType: MediaType;
    parsedTitle: string;
    normalizedTitle: string;
    group: { displayTitle: string; normalizedTitle: string; aliases: unknown } | null;
  } | null;
  items: Array<{ sourcePath?: string; conflict: boolean; sourceExists?: boolean }>;
}) {
  return assessOrganizerPlanAutomation(plan).autoExecutable;
}

export function assessOrganizerPlanAutomation(plan: {
  mediaType?: MediaType;
  status: string;
  confidence: number;
  autoExecutable?: boolean;
  candidate?: {
    mediaType: MediaType;
    parsedTitle: string;
    normalizedTitle: string;
    group: { displayTitle: string; normalizedTitle: string; aliases: unknown } | null;
  } | null;
  items: Array<{
    sourcePath?: string;
    targetPath?: string;
    fileType?: string;
    conflict: boolean;
    sourceExists?: boolean;
  }>;
}): OrganizerAutomationAssessment {
  const reasons: string[] = [];
  const terminal = ["EXECUTED", "AUTO_ARCHIVED", "REJECTED"].includes(plan.status);
  const failed = plan.status === "FAILED";

  if (terminal) {
    reasons.push("Plan is already closed.");
  } else if (failed) {
    reasons.push("Plan is marked as failed.");
  } else if (plan.status === "EXECUTING") {
    reasons.push("Plan execution is already in progress.");
  }
  if (!["PENDING", "NEEDS_REVIEW"].includes(plan.status)) {
    reasons.push("Plan is not in an executable status.");
  }
  if (plan.items.length === 0) {
    reasons.push("Plan has no files.");
  }
  if (plan.items.some((item) => item.conflict)) {
    reasons.push("Plan has target path conflicts.");
  }
  if (plan.items.some((item) => item.sourceExists === false)) {
    reasons.push("One or more source files are missing.");
  }
  if (plan.items.some((item) => item.targetPath && organizerTargetPathLooksPolluted(item.targetPath))) {
    reasons.push("Plan has a polluted target path.");
  }
  const mediaType = plan.mediaType ?? plan.candidate?.mediaType;
  if (
    plan.items.some(
      (item) =>
        item.sourcePath &&
        item.targetPath &&
        path.extname(item.sourcePath).toLowerCase() !== path.extname(item.targetPath).toLowerCase(),
    )
  ) {
    reasons.push("A target filename does not preserve the source extension.");
  }
  if (
    mediaType !== "MOVIE" &&
    plan.items.some(
      (item) =>
        item.sourcePath &&
        item.targetPath &&
        item.fileType?.startsWith("extra_") &&
        targetPathUsesExtrasDirectory(item.targetPath) &&
        sourcePathHasEpisodeIdentity(item.sourcePath, mediaType),
    )
  ) {
    reasons.push("Plan puts an episode video under Extras.");
  }
  if (
    mediaType !== "MOVIE" &&
    plan.items.some((item) => {
      if (!item.targetPath || (item.fileType && item.fileType !== "video")) {
        return false;
      }
      return !parseTargetPathEpisodeIdentity(item.targetPath);
    })
  ) {
    reasons.push("Plan has unresolved episode identity.");
  }

  const executable = reasons.length === 0;
  const autoReasons = [...reasons];

  if (plan.status !== "PENDING") {
    autoReasons.push("Automatic archive requires pending status.");
  }
  if (plan.confidence < minAutoOrganizerConfidence) {
    autoReasons.push("Confidence is below the automatic archive threshold.");
  }
  if (plan.autoExecutable === false) {
    autoReasons.push("Plan was not marked trusted when it was created.");
  }
  const candidate = plan.candidate;
  if (!candidate) {
    autoReasons.push("Plan has no grouped candidate.");
  } else if (
    plan.items.some((item) => item.sourcePath && !sourcePathMatchesCandidate(item.sourcePath, candidate))
  ) {
    autoReasons.push("One or more source files do not match the candidate title.");
  }

  return {
    executable,
    autoExecutable: autoReasons.length === 0,
    reasons: [...new Set(autoReasons)],
  };
}

export async function autoExecuteReadyOrganizerPlans(limit = 20) {
  const plans = await prisma.organizerPlan.findMany({
    where: {
      status: "PENDING",
      autoExecutable: true,
      confidence: { gte: minAutoOrganizerConfidence },
      items: { some: {} },
    },
    include: { items: true, candidate: { include: { group: true } } },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });
  let executed = 0;
  let skipped = 0;
  let failed = 0;

  for (const plan of plans) {
    const items = await withSourceExistence(plan.items);
    const assessment = assessOrganizerPlanAutomation({ ...plan, items });
    if (!assessment.autoExecutable) {
      skipped += 1;
      await prisma.organizerPlan.update({
        where: { id: plan.id },
        data: {
          autoExecutable: false,
          reason: `Automatic archive blocked: ${assessment.reasons.join(" ")}`,
        },
      });
      continue;
    }
    try {
      await executeOrganizerPlan(plan.id, true);
      executed += 1;
    } catch (error) {
      failed += 1;
      await prisma.organizerPlan.update({
        where: { id: plan.id },
        data: {
          status: "FAILED",
          reason: error instanceof Error ? error.message : "Automatic organizer execution failed.",
        },
      });
    }
  }

  return { inspected: plans.length, executed, skipped, failed };
}

export async function rejectOrganizerPlan(planId: string) {
  const rejected = await prisma.organizerPlan.updateMany({
    where: {
      id: planId,
      status: { in: ["PENDING", "NEEDS_REVIEW", "CONFLICT", "FAILED"] },
    },
    data: {
      status: "REJECTED",
      reason: "Rejected by user",
      resolvedAt: null,
      resolution: null,
    },
  });
  if (rejected.count !== 1) {
    throw new OrganizerExecutionBusyError(
      "Organizer plan is closed or currently executing and cannot be rejected.",
    );
  }
  return prisma.organizerPlan.findUniqueOrThrow({ where: { id: planId } });
}

export async function regenerateRejectedOrganizerPlan(planId: string) {
  const plan = await prisma.organizerPlan.findUniqueOrThrow({
    where: { id: planId },
    select: {
      id: true,
      status: true,
      resolvedAt: true,
      downloadId: true,
      items: { select: { sourcePath: true } },
      download: { select: { archiveStatus: true } },
    },
  });

  if (plan.status !== "REJECTED") {
    throw new Error("Only rejected organizer plans can be regenerated.");
  }
  if (plan.resolvedAt) {
    throw new Error("Resolved organizer plans cannot be regenerated.");
  }
  if (!plan.downloadId) {
    throw new Error("Rejected organizer plan has no linked download.");
  }

  const existingPlans = await prisma.organizerPlan.findMany({
    where: {
      downloadId: plan.downloadId,
      NOT: { id: plan.id },
    },
    select: { status: true, items: { select: { id: true } } },
  });
  if (hasBlockingOrganizerPlan(existingPlans)) {
    throw new Error("Download already has an active or completed organizer plan.");
  }

  const sourceItems = await withSourceExistence(plan.items);
  if (sourceItems.length === 0 || sourceItems.every((item) => !item.sourceExists)) {
    throw new Error("Rejected organizer plan source files are missing.");
  }

  let replacement: Awaited<ReturnType<typeof createOrganizerPlanForDownload>>;
  try {
    replacement = await createOrganizerPlanForDownload(plan.downloadId);
    const created = await prisma.organizerPlan.findUniqueOrThrow({
      where: { id: replacement.id },
      select: { items: { select: { id: true } } },
    });
    if (created.items.length === 0) {
      await prisma.organizerPlan.delete({ where: { id: replacement.id } });
      throw new Error("Replacement organizer plan has no files to process.");
    }
  } catch (error) {
    await prisma.download.update({
      where: { id: plan.downloadId },
      data: { archiveStatus: plan.download?.archiveStatus ?? "organizer_failed" },
    });
    throw error;
  }

  await prisma.organizerPlan.update({
    where: { id: plan.id },
    data: {
      resolvedAt: new Date(),
      resolution: `Regenerated as organizer plan ${replacement.id}.`,
    },
  });
  return replacement;
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

export async function cleanupStaleOrganizerPlans() {
  const plans = await prisma.organizerPlan.findMany({
    where: {
      status: { in: ["PENDING", "NEEDS_REVIEW", "CONFLICT", "FAILED"] },
    },
    include: {
      items: true,
      download: true,
      candidate: { include: { group: true } },
    },
  });
  let rejected = 0;
  let empty = 0;
  let missingSource = 0;
  let failedDownload = 0;
  let staleAutoFlags = 0;

  for (const plan of plans) {
    const reasons: string[] = [];
    const items = await withSourceExistence(plan.items);
    const assessment = assessOrganizerPlanAutomation({ ...plan, items });

    if (plan.autoExecutable !== assessment.autoExecutable) {
      await prisma.organizerPlan.update({
        where: { id: plan.id },
        data: { autoExecutable: assessment.autoExecutable },
      });
      staleAutoFlags += 1;
    }

    if (plan.items.length === 0) {
      empty += 1;
      if (
        /No video file found|no files?|AI review/i.test(plan.reason ?? "") ||
        plan.download?.status === "FAILED" ||
        plan.download?.archiveStatus === "organizer_failed" ||
        plan.updatedAt.getTime() < Date.now() - 24 * 60 * 60 * 1000
      ) {
        reasons.push("Organizer plan has no files left to process.");
      }
    }
    if (plan.download?.status === "FAILED" || plan.download?.archiveStatus === "organizer_failed") {
      failedDownload += 1;
      reasons.push("Linked download has failed.");
    }
    if (plan.items.length > 0) {
      const missing = items.filter((item) => item.sourceExists === false).length;
      if (missing > 0) {
        missingSource += missing;
        reasons.push(
          missing === plan.items.length
            ? "All source files are missing."
            : "One or more source files are missing.",
        );
      }
    }
    if (reasons.length === 0) {
      continue;
    }
    await prisma.organizerPlan.update({
      where: { id: plan.id },
      data: {
        status: "REJECTED",
        reason: `Stale organizer plan rejected: ${[...new Set(reasons)].join(" ")}`,
      },
    });
    rejected += 1;
  }

  return { inspected: plans.length, rejected, empty, missingSource, failedDownload, staleAutoFlags };
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

function selectedAria2SourcePaths(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((file): file is { path?: unknown; selected?: unknown } => {
      return typeof file === "object" && file !== null;
    })
    .filter((file) => file.selected !== "false")
    .map((file) => file.path)
    .filter((filePath): filePath is string => {
      return (
        typeof filePath === "string" &&
        filePath.length > 0 &&
        !filePath.startsWith("[METADATA]")
      );
    });
}

async function findOrganizerFiles(input: {
  sourceRoot: string;
  allowedRoots: string[];
  sourcePaths?: string[];
}): Promise<OrganizerSourceFile[]> {
  const root = assertInsideConfiguredRoots(input.sourceRoot, input.allowedRoots);
  if (input.sourcePaths && input.sourcePaths.length > 0) {
    const seen = new Set<string>();
    const files: OrganizerSourceFile[] = [];
    for (const sourcePath of [input.sourceRoot, ...input.sourcePaths]) {
      const resolvedPath = assertInsideConfiguredRoots(sourcePath, input.allowedRoots);
      if (seen.has(resolvedPath)) {
        continue;
      }
      seen.add(resolvedPath);
      const fileType = classifyOrganizerFile(resolvedPath);
      if (!fileType) {
        continue;
      }
      files.push({ sourcePath: resolvedPath, fileType });
    }
    return sortOrganizerSourceFiles(files, root);
  }

  const stat = await fs.stat(root);
  if (stat.isFile()) {
    const fileType = classifyOrganizerFile(root);
    return fileType ? [{ sourcePath: root, fileType }] : [];
  }
  const results: OrganizerSourceFile[] = [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(
        ...(await findOrganizerFiles({
          sourceRoot: fullPath,
          allowedRoots: input.allowedRoots,
        })),
      );
      continue;
    }
    const fileType = classifyOrganizerFile(entry.name);
    if (fileType) {
      results.push({ sourcePath: fullPath, fileType });
    }
  }
  return sortOrganizerSourceFiles(results, root);
}

function sortOrganizerSourceFiles(files: OrganizerSourceFile[], mainSourcePath: string) {
  const mainPath = path.resolve(mainSourcePath);
  return [...files].sort((a, b) => {
    const aMain = a.fileType === "video" && path.resolve(a.sourcePath) === mainPath;
    const bMain = b.fileType === "video" && path.resolve(b.sourcePath) === mainPath;
    if (aMain !== bMain) {
      return aMain ? -1 : 1;
    }
    return a.sourcePath.localeCompare(b.sourcePath);
  });
}

export function classifyOrganizerFile(filePath: string): OrganizerFileType | null {
  const ext = path.extname(filePath).toLowerCase();
  if (videoExtensions.has(ext)) {
    return "video";
  }
  if (audioExtensions.has(ext)) {
    return "audio";
  }
  if (imageExtensions.has(ext)) {
    return "image";
  }
  if (metadataFileExtensions.has(ext)) {
    return "metadata";
  }
  return null;
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
  items: Array<{ sourcePath: string; targetPath: string; fileType?: string | null }>;
  candidate: {
    mediaType: MediaType;
    parsedTitle: string;
    normalizedTitle: string;
    episodeNumber: number | null;
    season: number | null;
    group: { displayTitle: string; normalizedTitle: string; aliases: unknown } | null;
  } | null;
}) {
  if (!plan.candidate || plan.items.length === 0) {
    return false;
  }
  const candidate = plan.candidate;

  const targetPaths = plan.items.map((item) => item.targetPath).filter(Boolean);
  const hasDuplicateTargets = targetPaths.length > 1 && new Set(targetPaths).size < targetPaths.length;
  const hasPollutedTargets = plan.items.some((item) => organizerTargetPathLooksPolluted(item.targetPath));
  const hasEpisodeVideosInExtras = plan.items.some((item) => {
    if (item.fileType !== "extra_video") {
      return false;
    }
    const identity = resolveOrganizerItemIdentity({
      sourcePath: item.sourcePath,
      candidate,
    });
    return identity.episodeNumber !== null && sourcePathMatchesCandidate(item.sourcePath, candidate);
  });
  const mismatchedItems = plan.items.filter(
    (item) => !sourcePathMatchesCandidate(item.sourcePath, candidate),
  );

  return (
    hasDuplicateTargets ||
    hasPollutedTargets ||
    hasEpisodeVideosInExtras ||
    mismatchedItems.length === plan.items.length
  );
}

export function organizerTargetPathLooksPolluted(targetPath: string) {
  const filename = path.basename(targetPath, path.extname(targetPath));
  const episodeCodes = filename.match(/\bS\d{1,2}E\d{1,4}\b/gi) ?? [];
  if (episodeCodes.some((code) => code.toUpperCase() === "S00E00")) {
    return true;
  }
  if (new Set(episodeCodes.map((code) => code.toUpperCase())).size < episodeCodes.length) {
    return true;
  }
  const directorySegments = path.dirname(targetPath).split(path.sep).filter(Boolean);
  const seasonIndex = findLastSeasonDirectoryIndex(directorySegments);
  const seriesSegment =
    seasonIndex > 0 ? directorySegments[seasonIndex - 1] : directorySegments[directorySegments.length - 1];
  const filenameTitle = filename.split(/\s+-\s+S\d{1,2}E\d{1,4}\b/i)[0] ?? "";
  return [seriesSegment, filenameTitle].some((segment) => Boolean(segment && isLanguageOnlyTitleSegment(segment)));
}

function findLastSeasonDirectoryIndex(segments: string[]) {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (/^Season \d{1,2}$/i.test(segments[index])) {
      return index;
    }
  }
  return -1;
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

async function withSourceExistence<T extends { sourcePath: string }>(items: T[]) {
  return Promise.all(
    items.map(async (item) => ({
      ...item,
      sourceExists: await exists(item.sourcePath),
    })),
  );
}

function groupAliases(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

export function resolveOrganizerItemIdentity(input: {
  sourcePath: string;
  candidate: OrganizerCandidateIdentity;
  preferSourceEpisode?: boolean;
}) {
  const candidateSeason = input.candidate.season ?? 1;
  const candidateEpisode =
    input.candidate.episodeNumber !== null && input.candidate.episodeNumber !== undefined
      ? Math.floor(input.candidate.episodeNumber)
      : null;
  if (input.candidate.mediaType === "MOVIE") {
    return {
      season: 1,
      episodeNumber: 1,
      episodeTitle: input.candidate.parsedTitle,
      sourceParsedEpisode: null,
    };
  }

  const parsedSource = parseMediaReleaseTitle(
    path.basename(input.sourcePath, path.extname(input.sourcePath)),
    input.candidate.mediaType,
  );
  const sourceEpisode =
    parsedSource.episodeNumber !== undefined && parsedSource.episodeNumber > 0
      ? Math.floor(parsedSource.episodeNumber)
      : null;
  const sourceSeason =
    parsedSource.season !== undefined && parsedSource.season > 0
      ? parsedSource.season
      : candidateSeason;
  const canUseSourceEpisode =
    sourceEpisode !== null &&
    (candidateEpisode === null || input.preferSourceEpisode === true) &&
    sourcePathMatchesCandidate(input.sourcePath, input.candidate);

  return {
    season: canUseSourceEpisode ? sourceSeason : candidateSeason,
    episodeNumber: canUseSourceEpisode ? sourceEpisode : candidateEpisode,
    episodeTitle: parsedSource.parsedTitle || input.candidate.parsedTitle,
    sourceParsedEpisode: sourceEpisode,
  };
}

function shouldPreferSourceEpisodeForPackage(
  sourcePaths: string[],
  candidate: OrganizerCandidateIdentity,
) {
  if (sourcePaths.length < 2 || candidate.mediaType === "MOVIE") {
    return false;
  }
  const episodes = new Set<number>();
  for (const sourcePath of sourcePaths) {
    if (!sourcePathMatchesCandidate(sourcePath, candidate)) {
      continue;
    }
    const parsed = parseMediaReleaseTitle(
      path.basename(sourcePath, path.extname(sourcePath)),
      candidate.mediaType,
    );
    if (parsed.episodeNumber !== undefined && parsed.episodeNumber > 0) {
      episodes.add(Math.floor(parsed.episodeNumber));
    }
  }
  return episodes.size > 1;
}

export function resolveOrganizerMediaType(input: {
  candidate: OrganizerCandidateIdentity;
  sourceRoot: string;
  files: string[];
}): MediaType {
  if (input.candidate.mediaType !== "ANIME") {
    return input.candidate.mediaType;
  }

  const sourceText = [
    input.sourceRoot,
    ...input.files,
  ].join(" ");
  if (!looksTheatricalMoviePackage(sourceText)) {
    return input.candidate.mediaType;
  }

  const parsedFiles = input.files.map((file) =>
    parseMediaReleaseTitle(path.basename(file, path.extname(file)), "ANIME"),
  );
  const hasEpisodeNumber = parsedFiles.some((parsed) => parsed.episodeNumber !== undefined);
  return hasEpisodeNumber ? input.candidate.mediaType : "MOVIE";
}

function looksTheatricalMoviePackage(value: string) {
  return /(?:劇場版|剧场版|映画|the\s+movie|\bmovie\b|\bfilm\b|\btheatrical\b|\bbdrip\b|\bbdremux\b|\bblu\s?-?ray\b|\bbluray\b)/i.test(
    value,
  );
}

export function buildOrganizerTargetPath(input: {
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
  titleAliases?: string[];
}) {
  const title = sanitizeSegment(input.title);
  const seriesDir = input.year ? `${title} (${input.year})` : title;
  const seasonDir = `Season ${String(input.season).padStart(2, "0")}`;
  if (input.mediaType !== "MOVIE" && !input.episode) {
    return path.join(
      input.mediaType === "TV" ? input.roots.tvLibraryDir : input.roots.animeLibraryDir,
      "_Needs Review",
      seriesDir,
      sanitizeFilename(path.basename(input.sourcePath)),
    );
  }
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
    const filename = sanitizeFilename(`${movieName} ${tags}${ext}`);
    return path.join(
      /* turbopackIgnore: true */ input.roots.moviesLibraryDir,
      movieName,
      filename,
    );
  }
  const root =
    input.mediaType === "TV" ? input.roots.tvLibraryDir : input.roots.animeLibraryDir;
  const episodeTitle = buildOrganizerEpisodeTitleSegment({
    title,
    titleAliases: input.titleAliases,
    episodeTitle: input.episodeTitle,
    episodeCode: episode,
  });
  const filename = [
    title,
    episode,
    episodeTitle,
  ]
    .filter(Boolean)
    .join(" - ");
  const taggedFilename = [filename, tags].filter(Boolean).join(" ");
  return path.join(root, seriesDir, seasonDir, sanitizeFilename(`${taggedFilename}${ext}`));
}

export function buildOrganizerExtraTargetPath(input: {
  mediaType: MediaType;
  roots: {
    animeLibraryDir: string;
    moviesLibraryDir: string;
    tvLibraryDir: string;
  };
  title: string;
  year?: number;
  season: number;
  sourcePath: string;
  sourcePackageRoot: string;
}) {
  const title = sanitizeSegment(input.title);
  const mediaDir = input.year ? `${title} (${input.year})` : title;
  const baseDir =
    input.mediaType === "MOVIE"
      ? path.join(input.roots.moviesLibraryDir, mediaDir, "Extras")
      : path.join(
          input.mediaType === "TV" ? input.roots.tvLibraryDir : input.roots.animeLibraryDir,
          mediaDir,
          `Season ${String(input.season).padStart(2, "0")}`,
          "Extras",
        );
  return path.join(baseDir, relativeOrganizerExtraPath(input.sourcePath, input.sourcePackageRoot));
}

function resolveOrganizerSourcePackageRoot(input: {
  sourceRoot: string;
  sourcePaths: string[];
}) {
  const sourceRoot = path.resolve(input.sourceRoot);
  const paths = input.sourcePaths.map((sourcePath) => path.resolve(sourcePath));
  const parents = paths.map((sourcePath) => path.dirname(sourcePath));
  const common = commonDirectoryPath(parents);
  if (!common) {
    return path.dirname(sourceRoot);
  }
  return common === sourceRoot ? path.dirname(sourceRoot) : common;
}

function relativeOrganizerExtraPath(sourcePath: string, sourcePackageRoot: string) {
  const resolvedSource = path.resolve(sourcePath);
  const resolvedRoot = path.resolve(sourcePackageRoot);
  let relativePath = path.relative(resolvedRoot, resolvedSource);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    relativePath = path.basename(resolvedSource);
  }
  const rawSegments = relativePath.split(path.sep).filter(Boolean);
  const segments = rawSegments
    .map((segment, index) =>
      index === rawSegments.length - 1 ? sanitizeFilename(segment) : sanitizeSegment(segment),
    )
    .filter(Boolean);
  if (segments.length > 1 && /^extras?$/i.test(segments[0])) {
    segments.shift();
  }
  return path.join(
    ...(segments.length > 0 ? segments : [sanitizeFilename(path.basename(resolvedSource))]),
  );
}

function commonDirectoryPath(paths: string[]) {
  if (paths.length === 0) {
    return null;
  }
  const [first, ...rest] = paths.map((candidatePath) => path.resolve(candidatePath).split(path.sep));
  const commonSegments = [...first];
  for (const candidateSegments of rest) {
    let index = 0;
    while (
      index < commonSegments.length &&
      index < candidateSegments.length &&
      commonSegments[index] === candidateSegments[index]
    ) {
      index += 1;
    }
    commonSegments.length = index;
  }
  if (commonSegments.length === 0) {
    return path.parse(paths[0]).root;
  }
  return commonSegments.join(path.sep) || path.sep;
}

export function buildOrganizerEpisodeTitleSegment(input: {
  title: string;
  episodeTitle?: string | null;
  episodeCode: string;
  titleAliases?: string[];
}) {
  const titleAliasKeys = new Set(
    [input.title, ...(input.titleAliases ?? [])]
      .flatMap((value) => normalizeTitleAliases(value))
      .filter(Boolean),
  );
  const cleanedParts = splitEpisodeTitleParts(input.episodeTitle ?? "")
    .map((part) => cleanEpisodeTitlePart(part, input.episodeCode))
    .filter(Boolean)
    .filter((part) => {
      const aliases = normalizeTitleAliases(part);
      return aliases.length > 0 && aliases.every((alias) => !titleAliasKeys.has(alias));
    });
  const uniqueParts = [...new Set(cleanedParts)];
  if (uniqueParts.length === 0) {
    return null;
  }

  const segment = sanitizeSegment(uniqueParts.join(" / "));
  return segment || null;
}

function splitEpisodeTitleParts(value: string) {
  return value
    .replace(/\.[a-z0-9]{2,5}$/i, " ")
    .replace(/\[[^\]]+\]|【[^】]+】|\([^)]+\)/g, " - ")
    .split(/\s+-\s+|[|｜]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function cleanEpisodeTitlePart(value: string, episodeCode: string) {
  const escapedEpisodeCode = escapeRegExp(episodeCode);
  const withoutNoise = value
    .replace(new RegExp(`\\b${escapedEpisodeCode}\\b`, "gi"), " ")
    .replace(/\bS\d{1,2}E\d{1,4}\b/gi, " ")
    .replace(/\b(?:EP?)\s?\d{1,4}\b/gi, " ")
    .replace(/\b(?:2160p|4k|1080p|720p|480p|1920x1080|1280x720)\b/gi, " ")
    .replace(/\b(?:x265|x264|h\.?265|h\.?264|hevc|avc|av1|aac|flac|opus|mp3)\b/gi, " ")
    .replace(/\b(?:mkv|mp4|webm|avi|mov|baha|b-global|web\s?-?dl|webrip)\b/gi, " ");
  return sanitizeSegment(withoutNoise);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function upsertMediaRecords(plan: {
  mediaType: MediaType;
  mediaTitleId: string | null;
  metadata: unknown;
  items: Array<{
    targetPath: string;
    originalName: string;
    fileType: string;
    sizeBytes: bigint | null;
  }>;
  candidate: {
    mediaType: MediaType;
    parsedTitle: string;
    normalizedTitle: string;
    season: number | null;
    episodeNumber: number | null;
    resolution: string | null;
    codec: string | null;
    subtitleGroup: string | null;
    group: { displayTitle: string; normalizedTitle: string; aliases: unknown } | null;
  } | null;
}, database: Prisma.TransactionClient) {
  const metadata = plan.metadata as {
    title?: string;
    originalTitle?: string;
    year?: number;
    synopsis?: string;
    posterUrl?: string;
    backdropUrl?: string;
  } | null;
  const candidate = plan.candidate;
  const mediaType = plan.mediaType ?? candidate?.mediaType ?? "ANIME";
  const title = cleanMediaTitle(
    metadata?.title || candidate?.group?.displayTitle || candidate?.parsedTitle || "Unknown",
  );
  const titleAliasItems = plan.items.filter((item) => !isOrganizerExtraItem(item));
  const aliasValues = [
    title,
    metadata?.originalTitle,
    candidate?.group?.displayTitle,
    candidate?.group?.normalizedTitle,
    ...groupAliases(candidate?.group?.aliases),
    candidate?.parsedTitle,
    ...titleAliasItems.flatMap((item) => [
      item.originalName,
      parseMediaReleaseTitle(item.originalName, mediaType).parsedTitle,
      path.basename(item.targetPath, path.extname(item.targetPath)),
    ]),
    ...aliasesFromMetadataRaw((metadata as { raw?: unknown } | null)?.raw).map((alias) => alias.title),
  ];
  const media =
    (plan.mediaTitleId
      ? await database.mediaTitle.findUnique({ where: { id: plan.mediaTitleId } })
      : null) ??
    (await findExistingMediaTitle({
      type: mediaType,
      title,
      year: metadata?.year,
      originalTitle: metadata?.originalTitle,
      aliases: aliasValues,
    }, database)) ??
    (await database.mediaTitle.findFirst({
      where: {
        type: mediaType,
        primaryTitle: title,
        year: metadata?.year ?? null,
      },
    })) ??
    (await database.mediaTitle.create({
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
  await addMediaTitleAliases(media.id, aliasValues, database);
  await database.mediaTitle.update({
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
  for (const item of plan.items) {
    if (isOrganizerExtraItem(item)) {
      const existing = await database.mediaFile.findFirst({
        where: { absolutePath: item.targetPath },
        select: { id: true },
      });
      const data = {
        episodeId: null,
        relativePath: item.targetPath,
        absolutePath: item.targetPath,
        originalName: item.originalName,
        sizeBytes: item.sizeBytes,
        videoCodec: item.fileType === "extra_video" ? candidate?.codec : null,
        audioCodec: null,
        resolution: null,
        sourceResolution: null,
        playbackMode: null,
        transcodeStatus: "NOT_REQUIRED" as const,
        subtitleGroup: candidate?.subtitleGroup,
      };
      if (existing) {
        await database.mediaFile.update({
          where: { id: existing.id },
          data,
        });
        continue;
      }
      await database.mediaFile.create({ data });
      continue;
    }

    const targetIdentity = parseTargetPathEpisodeIdentity(item.targetPath);
    const identity =
      targetIdentity && candidate
        ? {
            season: targetIdentity.season,
            episodeNumber: targetIdentity.episodeNumber,
            episodeTitle: parseMediaReleaseTitle(item.originalName, mediaType).parsedTitle,
          }
        : candidate
          ? resolveOrganizerItemIdentity({
              candidate,
              sourcePath: item.originalName,
            })
          : {
              season: 1,
              episodeNumber: mediaType === "MOVIE" ? 1 : 0,
              episodeTitle: path.basename(item.originalName, path.extname(item.originalName)),
            };
    const season = await database.season.upsert({
      where: { mediaId_number: { mediaId: media.id, number: identity.season } },
      create: { mediaId: media.id, number: identity.season },
      update: {},
    });
    const episode = await database.episode.upsert({
      where: {
        seasonId_number: {
          seasonId: season.id,
          number: identity.episodeNumber ?? 0,
        },
      },
      create: {
        seasonId: season.id,
        number: identity.episodeNumber ?? 0,
        title: identity.episodeTitle,
      },
      update: { title: identity.episodeTitle },
    });
    const existing = await database.mediaFile.findFirst({
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
      await database.mediaFile.update({
        where: { id: existing.id },
        data,
      });
      continue;
    }
    await database.mediaFile.create({
      data: {
        ...data,
      },
    });
  }
  return media;
}

async function cacheOrganizerMediaArtwork(mediaId: string | null, metadataValue: unknown) {
  if (!mediaId) {
    return;
  }
  const metadata = metadataValue as {
    posterUrl?: string;
    backdropUrl?: string;
  } | null;
  const [posterUrl, backdropUrl] = await Promise.all([
    cacheRemoteMediaAsset(metadata?.posterUrl, { mediaId, kind: "poster" }),
    cacheRemoteMediaAsset(metadata?.backdropUrl, { mediaId, kind: "backdrop" }),
  ]);
  const data = {
    ...(posterUrl || isLocalMediaAssetUrl(metadata?.posterUrl)
      ? { posterUrl: posterUrl ?? metadata?.posterUrl }
      : {}),
    ...(backdropUrl || isLocalMediaAssetUrl(metadata?.backdropUrl)
      ? { backdropUrl: backdropUrl ?? metadata?.backdropUrl }
      : {}),
  };
  if (Object.keys(data).length > 0) {
    await prisma.mediaTitle.update({
      where: { id: mediaId },
      data,
    });
  }
}

function isOrganizerExtraItem(item: { targetPath: string; fileType?: string | null }) {
  if (item.fileType?.startsWith("extra_")) {
    return true;
  }
  return item.targetPath.split(path.sep).some((segment) => segment.toLowerCase() === "extras");
}

function organizerItemIntegrityIssue(input: {
  mediaType: MediaType;
  fileType: string;
  sourcePath: string;
  targetPath: string;
}) {
  if (path.extname(input.sourcePath).toLowerCase() !== path.extname(input.targetPath).toLowerCase()) {
    return "Organizer target filename does not preserve the source extension.";
  }
  if (
    input.mediaType !== "MOVIE" &&
    input.fileType.startsWith("extra_") &&
    targetPathUsesExtrasDirectory(input.targetPath) &&
    sourcePathHasEpisodeIdentity(input.sourcePath, input.mediaType)
  ) {
    return "Organizer plan puts an episode video under Extras.";
  }
  return null;
}

function targetPathUsesExtrasDirectory(targetPath: string) {
  return targetPath.split(path.sep).some((segment) => /^extras?$/i.test(segment));
}

function sourcePathHasEpisodeIdentity(sourcePath: string, mediaType: MediaType | undefined) {
  if (!mediaType || mediaType === "MOVIE") {
    return false;
  }
  const parsed = parseMediaReleaseTitle(
    path.basename(sourcePath, path.extname(sourcePath)),
    mediaType,
  );
  return parsed.episodeNumber !== undefined && parsed.episodeNumber > 0;
}

function cleanMediaTitle(value: string) {
  return value
    .replace(/\s*\[\s*\]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const languageOnlyTitleTokenPattern =
  /^(?:国|國|日|中|英|粤|粵|简|簡|繁|chs|cht|sc|tc|gb|big5|jpn|japanese|eng|english|multi|双语|雙語|简体|簡體|繁体|繁體|日语|日語|国语|國語|英语|英語)$/i;

function isLanguageOnlyTitleSegment(value: string) {
  const normalized = value.replace(/\(\d{4}\)$/, "").trim();
  const tokens = normalized
    .split(/[\/╱\\+&|｜,，、\s._-]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  return tokens.length > 0 && tokens.length <= 4 && tokens.every((token) => languageOnlyTitleTokenPattern.test(token));
}

function sanitizeSegment(value: string, maxBytes = 140) {
  const cleaned = value.replace(/[/:*?"<>|\\]/g, " ").replace(/\s+/g, " ").trim();
  return truncateUtf8(cleaned, maxBytes);
}

function sanitizeFilename(value: string, maxBytes = 240) {
  const extension = path.extname(value).replace(/[/:*?"<>|\\]/g, "");
  const basename = path.basename(value, path.extname(value));
  const extensionBytes = Buffer.byteLength(extension);
  const safeBasename = sanitizeSegment(basename, Math.max(1, maxBytes - extensionBytes));
  return `${safeBasename || "file"}${extension}`;
}

function truncateUtf8(value: string, maxBytes: number) {
  let result = "";
  let bytes = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character);
    if (bytes + characterBytes > maxBytes) {
      break;
    }
    result += character;
    bytes += characterBytes;
  }
  return result;
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
