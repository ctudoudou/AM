import { Prisma, type Download } from "@prisma/client";
import {
  addHttpUrlToAria2,
  removeAria2Download,
  removeAria2DownloadResult,
} from "@/lib/aria2";
import { normalizeTitle, normalizeTitleAliases } from "@/lib/anime-parser";
import { prisma } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import {
  assertVideoSourcePlanCurrent,
  inspectVideoSource,
} from "./registry";
import { resolveVideoEpisode } from "./resolver";
import type {
  ResolvedVideoSource,
  VideoSourceEpisode,
  VideoSourceInspection,
} from "./types";

const activeStatuses = new Set(["WAITING", "ACTIVE", "PAUSED", "COMPLETED"]);

export class VideoSourceImportValidationError extends Error {}

export type QueueVideoSourceResult = {
  episodeKey: string;
  episodeNumber: number;
  status: "queued" | "skipped" | "failed";
  downloadId: string | null;
  sourceId: string | null;
  message: string;
};

export async function queueVideoSourceImports(input: {
  url: string;
  planId: string;
  episodeKeys: string[];
}) {
  const inspection = await inspectVideoSource(input.url);
  assertVideoSourcePlanCurrent(inspection, input.planId);
  const requested = new Set(input.episodeKeys);
  if (requested.size === 0 || requested.size > 24 || requested.size !== input.episodeKeys.length) {
    throw new VideoSourceImportValidationError("Select between 1 and 24 unique episodes.");
  }
  const episodes = inspection.episodes.filter((episode) => requested.has(episode.key));
  if (episodes.length !== requested.size) {
    throw new VideoSourceImportValidationError(
      "One or more selected episodes are not part of the current source plan.",
    );
  }

  const results = await mapWithConcurrency(episodes, 2, (episode) =>
    queueSingleEpisode(inspection, episode),
  );
  return {
    planId: inspection.planId,
    requested: episodes.length,
    queued: results.filter((result) => result.status === "queued").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    failed: results.filter((result) => result.status === "failed").length,
    results,
  };
}

export async function retryVideoSourceImport(downloadId: string): Promise<Download> {
  const sourceImport = await prisma.videoSourceImport.findUniqueOrThrow({
    where: { downloadId },
    include: { download: true },
  });
  if (!sourceImport.download || sourceImport.download.status !== "FAILED") {
    throw new Error("Only failed video source downloads can be retried.");
  }
  const inspection = await inspectVideoSource(sourceImport.sourcePageUrl);
  const episode = inspection.episodes.find((candidate) => candidate.key === sourceImport.episodeKey);
  if (!episode) {
    throw new Error("The source page no longer contains this episode.");
  }
  const result = await queueSingleEpisode(inspection, episode, true);
  if (result.status === "failed") {
    throw new Error(result.message);
  }
  return prisma.download.findUniqueOrThrow({ where: { id: downloadId } });
}

export async function retryVideoSourceImportIfPresent(downloadId: string) {
  const sourceImport = await prisma.videoSourceImport.findUnique({
    where: { downloadId },
    select: { id: true },
  });
  return sourceImport ? retryVideoSourceImport(downloadId) : null;
}

async function queueSingleEpisode(
  inspection: VideoSourceInspection,
  episode: VideoSourceEpisode,
  force = false,
): Promise<QueueVideoSourceResult> {
  const ensured = await ensureImportRecord(inspection, episode);
  const sourceImport = ensured.record;
  const existingDownload = sourceImport.download;
  if (
    !force &&
    !ensured.created &&
    existingDownload &&
    sourceImport.status === "QUEUED" &&
    activeStatuses.has(existingDownload.status)
  ) {
    return {
      episodeKey: episode.key,
      episodeNumber: episode.number,
      status: "skipped",
      downloadId: existingDownload.id,
      sourceId: sourceImport.selectedSourceId,
      message: "This source episode already has a tracked download.",
    };
  }
  if (!sourceImport.downloadId || !sourceImport.candidateId) {
    throw new Error("Video source import is missing its download or candidate record.");
  }

  await prisma.$transaction([
    prisma.videoSourceImport.update({
      where: { id: sourceImport.id },
      data: { status: "RESOLVING", errorMessage: null },
    }),
    prisma.download.update({
      where: { id: sourceImport.downloadId },
      data: {
        status: "WAITING",
        errorMessage: null,
        stalledSince: null,
        nextRetryAt: null,
      },
    }),
  ]);

  const operation = await prisma.operationLog.create({
    data: {
      domain: "DOWNLOAD",
      action: "IMPORT_VIDEO_SOURCE",
      status: "STARTED",
      entityType: "VideoSourceImport",
      entityId: sourceImport.id,
      externalId: `${inspection.provider}:${inspection.sourceItemId}:${episode.key}`,
      planId: inspection.planId,
      details: {
        provider: inspection.provider,
        sourceItemId: inspection.sourceItemId,
        episodeKey: episode.key,
        episodeNumber: episode.number,
        availableSources: episode.sources.map((source) => source.id),
      } as Prisma.InputJsonValue,
    },
  });

  let gid: string | null = null;
  try {
    const resolved = await resolveVideoEpisode(inspection.provider, episode);
    const settings = await getAppSettings();
    const outputFilename = buildVideoImportFilename(
      inspection.title,
      inspection.seasonNumber,
      episode.number,
      inspection.provider,
    );
    if (existingDownload?.aria2Gid) {
      await removeAria2Download(existingDownload.aria2Gid)
        .catch(async () => removeAria2DownloadResult(existingDownload.aria2Gid as string))
        .catch(() => null);
    }
    gid = await addHttpUrlToAria2(
      resolved.mediaUrl,
      settings.directories.downloadsDir,
      aria2OptionsForResolvedMedia(outputFilename, resolved),
    );

    await prisma.$transaction([
      prisma.download.update({
        where: { id: sourceImport.downloadId },
        data: {
          aria2Gid: gid,
          status: "WAITING",
          sourceUrl: resolved.sourcePageUrl,
          title: displayEpisodeTitle(
            inspection.title,
            inspection.seasonNumber,
            episode.number,
          ),
          totalBytes: resolved.sizeBytes,
          completedBytes: BigInt(0),
          downloadSpeed: BigInt(0),
          progress: 0,
          downloadDir: settings.directories.downloadsDir,
          aria2Files: Prisma.DbNull,
          targetPath: null,
          errorMessage: null,
          archiveStatus: null,
          lastSyncedAt: new Date(),
          stalledSince: null,
          nextRetryAt: null,
        },
      }),
      prisma.releaseCandidate.update({
        where: { id: sourceImport.candidateId },
        data: {
          sourceUrl: resolved.sourcePageUrl,
          status: "SUBSCRIBED",
        },
      }),
      prisma.videoSourceImport.update({
        where: { id: sourceImport.id },
        data: {
          status: "QUEUED",
          selectedSourceId: resolved.sourceId,
          mediaFormat: resolved.format,
          mediaHost: resolved.mediaHost,
          sizeBytes: resolved.sizeBytes,
          outputFilename,
          errorMessage: null,
        },
      }),
    ]);

    await prisma.operationLog
      .update({
        where: { id: operation.id },
        data: {
          status: "SUCCEEDED",
          completedAt: new Date(),
          details: {
            provider: inspection.provider,
            sourceItemId: inspection.sourceItemId,
            episodeKey: episode.key,
            episodeNumber: episode.number,
            selectedSourceId: resolved.sourceId,
            mediaHost: resolved.mediaHost,
            mediaFormat: resolved.format,
            sizeBytes: resolved.sizeBytes?.toString() ?? null,
            aria2Gid: gid,
            outputFilename,
          } as Prisma.InputJsonValue,
          rollbackData: { action: "remove", gid } as Prisma.InputJsonValue,
        },
      })
      .catch(() => null);

    return {
      episodeKey: episode.key,
      episodeNumber: episode.number,
      status: "queued",
      downloadId: sourceImport.downloadId,
      sourceId: resolved.sourceId,
      message: "Direct MP4 source resolved and queued in aria2.",
    };
  } catch (error) {
    const message = importErrorMessage(error);
    if (gid) {
      await removeAria2Download(gid)
        .catch(async () => removeAria2DownloadResult(gid as string))
        .catch(() => null);
    }
    await prisma
      .$transaction([
        prisma.videoSourceImport.update({
          where: { id: sourceImport.id },
          data: { status: "FAILED", errorMessage: message },
        }),
        prisma.download.update({
          where: { id: sourceImport.downloadId },
          data: {
            aria2Gid: null,
            status: "FAILED",
            downloadSpeed: BigInt(0),
            errorMessage: message,
            lastSyncedAt: new Date(),
          },
        }),
        prisma.operationLog.update({
          where: { id: operation.id },
          data: {
            status: "FAILED",
            errorMessage: message,
            completedAt: new Date(),
          },
        }),
      ])
      .catch(() => null);
    return {
      episodeKey: episode.key,
      episodeNumber: episode.number,
      status: "failed",
      downloadId: sourceImport.downloadId,
      sourceId: null,
      message,
    };
  }
}

async function ensureImportRecord(
  inspection: VideoSourceInspection,
  episode: VideoSourceEpisode,
) {
  const downloadDir = (await getAppSettings()).directories.downloadsDir;
  const where = {
    provider_sourceItemId_episodeKey: {
      provider: inspection.provider,
      sourceItemId: inspection.sourceItemId,
      episodeKey: episode.key,
    },
  } as const;
  const existing = await prisma.videoSourceImport.findUnique({
    where,
    include: { download: true },
  });
  if (existing) {
    return { record: existing, created: false };
  }

  try {
    const record = await prisma.$transaction(async (tx) => {
      const normalizedTitle = normalizeTitle(inspection.title);
      const group = await tx.releaseCandidateGroup.upsert({
        where: {
          mediaType_normalizedTitle_season: {
            mediaType: "ANIME",
            normalizedTitle,
            season: inspection.seasonNumber,
          },
        },
        create: {
          mediaType: "ANIME",
          normalizedTitle,
          displayTitle: inspection.title,
          season: inspection.seasonNumber,
          confidence: 1,
          reviewRequired: false,
          aiSummary: `Created from the ${inspection.provider} video source plugin.`,
          aliases: normalizeTitleAliases(inspection.title) as Prisma.InputJsonValue,
        },
        update: {
          displayTitle: inspection.title,
          aliases: normalizeTitleAliases(inspection.title) as Prisma.InputJsonValue,
        },
      });
      const rawTitle = displayEpisodeTitle(
        inspection.title,
        inspection.seasonNumber,
        episode.number,
      );
      const rssItem = await tx.rssItem.create({
        data: {
          origin: "video-plugin",
          mediaType: "ANIME",
          guid: `${inspection.provider}:${inspection.sourceItemId}:${episode.key}`,
          title: rawTitle,
          link: episode.sources[0]?.playUrl ?? inspection.sourceUrl,
          status: "GROUPED",
          raw: {
            provider: inspection.provider,
            sourceItemId: inspection.sourceItemId,
            sourcePageUrl: inspection.sourceUrl,
            episodeKey: episode.key,
            episodeNumber: episode.number,
            sources: episode.sources,
          } as Prisma.InputJsonValue,
        },
      });
      const candidate = await tx.releaseCandidate.create({
        data: {
          groupId: group.id,
          rssItemId: rssItem.id,
          mediaType: "ANIME",
          rawTitle,
          parsedTitle: inspection.title,
          normalizedTitle,
          episodeNumber: episode.number,
          season: inspection.seasonNumber,
          releaseProfile: `WEB / ${inspection.provider}`,
          sourceKind: "WEB",
          variantKey: `web|${inspection.provider}`,
          releaseTags: ["WEB", inspection.provider] as Prisma.InputJsonValue,
          episodeIdentity: {
            seasonNumber: inspection.seasonNumber,
            episodeNumber: episode.number,
            mode: "explicit_video_source",
          } as Prisma.InputJsonValue,
          sourceUrl: episode.sources[0]?.playUrl ?? inspection.sourceUrl,
          confidence: 1,
          status: "SUBSCRIBED",
        },
      });
      const download = await tx.download.create({
        data: {
          candidateId: candidate.id,
          status: "WAITING",
          sourceUrl: episode.sources[0]?.playUrl ?? inspection.sourceUrl,
          title: rawTitle,
          progress: 0,
          downloadDir,
        },
      });
      return tx.videoSourceImport.create({
        data: {
          provider: inspection.provider,
          sourceItemId: inspection.sourceItemId,
          episodeKey: episode.key,
          sourcePageUrl: inspection.sourceUrl,
          title: inspection.title,
          seasonNumber: inspection.seasonNumber,
          episodeNumber: episode.number,
          posterUrl: inspection.posterUrl,
          candidateId: candidate.id,
          downloadId: download.id,
          status: "RESOLVING",
        },
        include: { download: true },
      });
    });
    return { record, created: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await prisma.videoSourceImport.findUniqueOrThrow({
        where,
        include: { download: true },
      });
      return { record: raced, created: false };
    }
    throw error;
  }
}

function aria2OptionsForResolvedMedia(
  outputFilename: string,
  resolved: ResolvedVideoSource,
) {
  const headers = [
    resolved.requestHeaders.origin ? `Origin: ${resolved.requestHeaders.origin}` : null,
  ].filter((header): header is string => Boolean(header));
  return {
    out: outputFilename,
    continue: "true",
    "check-integrity": "true",
    "allow-overwrite": "false",
    "auto-file-renaming": "false",
    "max-connection-per-server": "8",
    split: "8",
    "min-split-size": "1M",
    ...(resolved.requestHeaders.referer ? { referer: resolved.requestHeaders.referer } : {}),
    ...(resolved.requestHeaders.userAgent
      ? { "user-agent": resolved.requestHeaders.userAgent }
      : {}),
    ...(headers.length > 0 ? { header: headers } : {}),
  };
}

export function buildVideoImportFilename(
  title: string,
  seasonNumber: number,
  episodeNumber: number,
  provider: string,
) {
  const safeTitle = title
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "Unknown title";
  const providerTag = provider.toUpperCase().replace(/[^A-Z0-9_-]/g, "") || "WEB";
  return `[${providerTag}] ${safeTitle} - S${padNumber(seasonNumber)}E${formatEpisodeNumber(episodeNumber)} [WEB].mp4`;
}

function displayEpisodeTitle(title: string, seasonNumber: number, episodeNumber: number) {
  return `${title} - S${padNumber(seasonNumber)}E${formatEpisodeNumber(episodeNumber)}`;
}

function padNumber(value: number) {
  return String(value).padStart(2, "0");
}

function formatEpisodeNumber(value: number) {
  if (Number.isInteger(value)) {
    return padNumber(value);
  }
  return String(value).replace(".", "_");
}

function importErrorMessage(error: unknown) {
  if (error instanceof Error && "attempts" in error && Array.isArray(error.attempts)) {
    const attempts = error.attempts
      .slice(0, 4)
      .map((attempt) => `${attempt.sourceId}: ${attempt.message}`)
      .join("; ");
    return attempts ? `${error.message} ${attempts}` : error.message;
  }
  return error instanceof Error ? error.message : "Unknown video source import error";
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  );
  return results;
}
