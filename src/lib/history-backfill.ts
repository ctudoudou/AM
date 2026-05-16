import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeTitleAliases } from "@/lib/anime-parser";
import { analyzeEpisodeIdentity, type EpisodeIdentity } from "@/lib/episode-identity";
import { parseMediaReleaseTitle } from "@/lib/media-parser";
import {
  searchWantedEpisodeSources,
  selectWantedSearchResultForDownload,
  type WantedSearchResult,
  type WantedSearchSourceError,
} from "@/lib/wanted-rss-search";
import { scanWantedEpisodes } from "@/lib/wanted-episodes";

export type HistoryBackfillResult = WantedSearchResult & {
  identity: EpisodeIdentity;
  safeToDownload: boolean;
  safetyReason: string;
};

export type HistoryBackfillEpisodeResult = {
  seasonNumber: number;
  episodeNumber: number;
  wantedId: string;
  queries: string[];
  results: HistoryBackfillResult[];
  sourceErrors: WantedSearchSourceError[];
};

export async function searchHistoryBackfill(input: {
  mediaTitleId: string;
  seasonNumber: number;
  episodeStart: number;
  episodeEnd: number;
}) {
  const seasonNumber = positiveInteger(input.seasonNumber, "seasonNumber");
  const episodeStart = positiveInteger(input.episodeStart, "episodeStart");
  const episodeEnd = positiveInteger(input.episodeEnd, "episodeEnd");
  if (episodeEnd < episodeStart) {
    throw new Error("episodeEnd must be greater than or equal to episodeStart");
  }
  if (episodeEnd - episodeStart > 48) {
    throw new Error("Backfill range is too large. Search up to 49 episodes at a time.");
  }

  const media = await prisma.mediaTitle.findUniqueOrThrow({
    where: { id: input.mediaTitleId },
    include: { aliases: true },
  });
  if (media.type !== "ANIME") {
    throw new Error("History backfill is currently only available for anime titles.");
  }

  const wantedRows = [];
  for (let episodeNumber = episodeStart; episodeNumber <= episodeEnd; episodeNumber += 1) {
    wantedRows.push(await ensureWantedEpisode(media.id, seasonNumber, episodeNumber));
  }

  const mediaAliasSet = new Set(
    [media.primaryTitle, media.originalTitle, ...media.aliases.map((alias) => alias.title)]
      .filter((title): title is string => Boolean(title?.trim()))
      .flatMap((title) => normalizeTitleAliases(title)),
  );
  const siblingCandidates = await loadSiblingCandidates(media.id, seasonNumber);
  const episodes: HistoryBackfillEpisodeResult[] = [];

  for (const wanted of wantedRows) {
    const search = await searchWantedEpisodeSources(wanted.id);
    const results = search.results
      .map((result) =>
        assessHistoryBackfillResult({
          mediaAliasSet,
          result,
          seasonNumber,
          siblingCandidates,
          targetEpisode: wanted.episodeNumber,
        }),
      )
      .filter((result) => result.identity.normalizedEpisode === wanted.episodeNumber || result.identity.requiresReview)
      .sort((a, b) => Number(b.safeToDownload) - Number(a.safeToDownload) || b.identity.confidence - a.identity.confidence)
      .slice(0, 20);
    episodes.push({
      seasonNumber,
      episodeNumber: wanted.episodeNumber,
      wantedId: wanted.id,
      queries: search.queries,
      results,
      sourceErrors: search.sourceErrors,
    });
  }

  return {
    mediaTitleId: media.id,
    title: media.primaryTitle,
    seasonNumber,
    episodeStart,
    episodeEnd,
    episodes,
  };
}

export async function selectHistoryBackfillDownload(input: {
  mediaTitleId: string;
  seasonNumber: number;
  episodeNumber: number;
  result: WantedSearchResult;
}) {
  const seasonNumber = positiveInteger(input.seasonNumber, "seasonNumber");
  const episodeNumber = positiveInteger(input.episodeNumber, "episodeNumber");
  const media = await prisma.mediaTitle.findUniqueOrThrow({
    where: { id: input.mediaTitleId },
    include: { aliases: true },
  });
  if (media.type !== "ANIME") {
    throw new Error("History backfill is currently only available for anime titles.");
  }
  const mediaAliasSet = new Set(
    [media.primaryTitle, media.originalTitle, ...media.aliases.map((alias) => alias.title)]
      .filter((title): title is string => Boolean(title?.trim()))
      .flatMap((title) => normalizeTitleAliases(title)),
  );
  const assessed = assessHistoryBackfillResult({
    mediaAliasSet,
    result: input.result,
    seasonNumber,
    siblingCandidates: await loadSiblingCandidates(media.id, seasonNumber),
    targetEpisode: episodeNumber,
  });
  if (!assessed.safeToDownload) {
    throw new Error(`Selected release requires review: ${assessed.safetyReason}`);
  }

  const wanted = await ensureWantedEpisode(media.id, seasonNumber, episodeNumber);
  const output = await selectWantedSearchResultForDownload(wanted.id, input.result);
  await prisma.releaseCandidate.update({
    where: { id: output.candidate.id },
    data: {
      confidence: Math.max(output.candidate.confidence, 0.92),
      status: "SUBSCRIBED",
    },
  });
  if (output.candidate.groupId) {
    const group = await prisma.releaseCandidateGroup.findUnique({
      where: { id: output.candidate.groupId },
      select: { confidence: true },
    });
    await prisma.releaseCandidateGroup.update({
      where: { id: output.candidate.groupId },
      data: {
        confidence: group && group.confidence > 0.92 ? group.confidence : 0.92,
        reviewRequired: false,
        aiSummary: "Safe single-episode history backfill selection.",
      },
    });
  }
  await scanWantedEpisodes(media.id);
  return {
    ...output,
    identity: assessed.identity,
  };
}

function assessHistoryBackfillResult(input: {
  mediaAliasSet: Set<string>;
  result: WantedSearchResult;
  seasonNumber: number;
  siblingCandidates: Array<{
    rawTitle: string;
    parsedTitle: string | null;
    normalizedTitle: string | null;
    season: number | null;
    episodeNumber: number | null;
  }>;
  targetEpisode: number;
}): HistoryBackfillResult {
  const parsed = parseMediaReleaseTitle(input.result.title, "ANIME");
  const titleMatches = normalizeTitleAliases(parsed.parsedTitle)
    .concat(normalizeTitleAliases(parsed.normalizedTitle))
    .some((alias) => input.mediaAliasSet.has(alias));
  const identity = analyzeEpisodeIdentity({
    rawTitle: input.result.title,
    parsed,
    siblingCandidates: input.siblingCandidates,
    targetEpisode: input.targetEpisode,
    targetSeason: input.seasonNumber,
  });
  const safeToDownload =
    titleMatches &&
    identity.safeForAutoDownload &&
    input.result.match === "strong";
  return {
    ...input.result,
    match: safeToDownload ? "strong" : input.result.match,
    identity,
    safeToDownload,
    safetyReason: safetyReason({ identity, titleMatches, result: input.result }),
  };
}

function safetyReason(input: {
  identity: EpisodeIdentity;
  titleMatches: boolean;
  result: WantedSearchResult;
}) {
  if (!input.titleMatches) {
    return "Title aliases do not match the target media.";
  }
  if (input.result.match !== "strong") {
    return "Search result is not a strong title/season/episode match.";
  }
  if (input.identity.numberingScheme === "batch_range") {
    return "Batch releases must be reviewed before downloading.";
  }
  if (input.identity.numberingScheme === "absolute_series") {
    return "Absolute or cumulative episode numbering needs review evidence.";
  }
  if (input.identity.numberingScheme === "cour_relative" || input.identity.numberingScheme === "part_relative") {
    return "Cour/part numbering must be reviewed against the target season.";
  }
  if (input.identity.rawEpisode === null) {
    return "No episode number was parsed from this release.";
  }
  if (input.identity.rawEpisode !== input.identity.targetEpisode) {
    return "Parsed episode does not match the target episode.";
  }
  if (input.identity.safeForAutoDownload) {
    return "Safe single-episode season-relative match.";
  }
  return "Release requires manual review.";
}

async function ensureWantedEpisode(mediaTitleId: string, seasonNumber: number, episodeNumber: number) {
  return prisma.wantedEpisode.upsert({
    where: {
      mediaTitleId_seasonNumber_episodeNumber: {
        mediaTitleId,
        seasonNumber,
        episodeNumber,
      },
    },
    create: {
      mediaTitleId,
      seasonNumber,
      episodeNumber,
      status: "MISSING",
      reason: "Created by history backfill search",
    },
    update: {
      reason: "Updated by history backfill search",
    },
  });
}

async function loadSiblingCandidates(mediaTitleId: string, seasonNumber: number) {
  const media = await prisma.mediaTitle.findUniqueOrThrow({
    where: { id: mediaTitleId },
    include: { aliases: true },
  });
  const aliases = [media.primaryTitle, media.originalTitle, ...media.aliases.map((alias) => alias.title)]
    .filter((title): title is string => Boolean(title?.trim()))
    .flatMap((title) => normalizeTitleAliases(title));
  if (aliases.length === 0) {
    return [];
  }
  const candidates = await prisma.releaseCandidate.findMany({
    where: {
      mediaType: "ANIME",
      season: seasonNumber,
      OR: aliases.slice(0, 16).map((alias) => ({
        normalizedTitle: { contains: alias, mode: "insensitive" },
      })),
    },
    select: {
      rawTitle: true,
      parsedTitle: true,
      normalizedTitle: true,
      season: true,
      episodeNumber: true,
    },
    orderBy: { createdAt: "desc" },
    take: 80,
  });
  return candidates.map((candidate) => ({
    rawTitle: candidate.rawTitle,
    parsedTitle: candidate.parsedTitle,
    normalizedTitle: candidate.normalizedTitle,
    season: candidate.season,
    episodeNumber: normalizeEpisodeNumber(candidate.episodeNumber),
  }));
}

function normalizeEpisodeNumber(value: Prisma.Decimal | number | null) {
  if (value === null) {
    return null;
  }
  const number = typeof value === "number" ? value : value.toNumber();
  return Number.isFinite(number) ? number : null;
}

function positiveInteger(value: unknown, label: string) {
  const number = typeof value === "number" ? Math.floor(value) : Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return number;
}
