import type { MediaTitle, ReleaseCandidate, WantedEpisodeStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeTitleAliases } from "@/lib/anime-parser";
import { enqueueCandidateDownload } from "@/lib/downloads";
import { normalizeCandidateEpisodeNumber } from "@/lib/episode-normalizer";

type CandidateWithState = ReleaseCandidate & {
  downloads: Array<{ status: string }>;
  organizerPlans: Array<{ status: string; items: Array<{ id: string }> }>;
  group: { displayTitle: string; normalizedTitle: string; aliases: unknown } | null;
};

type MediaWithEpisodes = MediaTitle & {
  aliases: Array<{ title: string }>;
  seasons: Array<{
    number: number;
    episodes: Array<{
      id: string;
      number: number;
      title: string | null;
      overview?: string | null;
      airDate?: Date | null;
      files: Array<{ id: string; originalName?: string | null }>;
    }>;
  }>;
};

export type EpisodeCoverageItem = {
  seasonNumber: number;
  episodeNumber: number;
  status: WantedEpisodeStatus | "AVAILABLE";
  episodeId: string | null;
  mediaFileCount: number;
  wantedId: string | null;
  candidateId: string | null;
  candidateTitle: string | null;
  reason: string | null;
};

export async function getAnimeEpisodeCoverage(mediaTitleId: string) {
  return getMediaEpisodeCoverage(mediaTitleId, "ANIME");
}

export async function getTvEpisodeCoverage(mediaTitleId: string) {
  return getMediaEpisodeCoverage(mediaTitleId, "TV");
}

async function getMediaEpisodeCoverage(mediaTitleId: string, expectedType: "ANIME" | "TV") {
  const media = await loadMedia(mediaTitleId);
  if (media.type !== expectedType) {
    throw new Error(`Wanted episodes are only available for ${expectedType} titles.`);
  }
  const candidates = await findCandidatesForMedia(media);
  const wanted = await prisma.wantedEpisode.findMany({
    where: { mediaTitleId },
  });
  return buildWantedEpisodeCoverage(media, candidates, wanted);
}

export async function repairAnimeEpisodeNumbering(input?: { mediaTitleId?: string }) {
  const mediaTitles = await prisma.mediaTitle.findMany({
    where: {
      type: "ANIME",
      id: input?.mediaTitleId,
    },
    select: { id: true },
    orderBy: { updatedAt: "desc" },
  });
  let repairedEpisodes = 0;
  let movedFiles = 0;
  let rescannedWanted = 0;

  for (const mediaTitle of mediaTitles) {
    const media = await loadMedia(mediaTitle.id);
    const candidates = await findCandidatesForMedia(media);

    for (const season of media.seasons) {
      for (const episode of season.episodes) {
        const rawTitle = episode.files[0]?.originalName ?? episode.title ?? "";
        const normalized = normalizeCandidateEpisodeNumber(
          {
            rawTitle,
            parsedTitle: [episode.title, media.primaryTitle, media.originalTitle].filter(Boolean).join(" "),
            normalizedTitle: media.primaryTitle,
            season: season.number,
            episodeNumber: episode.number,
          },
          candidates,
        );
        if (
          normalized.episodeNumber === null ||
          normalized.season !== season.number ||
          normalized.episodeNumber === episode.number
        ) {
          continue;
        }

        const targetEpisode = await prisma.episode.upsert({
          where: {
            seasonId_number: {
              seasonId: season.id,
              number: normalized.episodeNumber,
            },
          },
          create: {
            seasonId: season.id,
            number: normalized.episodeNumber,
            title: episode.title,
            overview: episode.overview,
            airDate: episode.airDate,
          },
          update: {
            title: episode.title ?? undefined,
            overview: episode.overview ?? undefined,
            airDate: episode.airDate ?? undefined,
          },
        });
        const files = await prisma.mediaFile.updateMany({
          where: { episodeId: episode.id },
          data: { episodeId: targetEpisode.id },
        });
        await prisma.watchProgress.updateMany({
          where: { episodeId: episode.id },
          data: { episodeId: targetEpisode.id },
        });
        await prisma.subtitleTrack.updateMany({
          where: { episodeId: episode.id },
          data: { episodeId: targetEpisode.id },
        });
        await prisma.episode.delete({ where: { id: episode.id } }).catch(() => null);
        movedFiles += files.count;
        repairedEpisodes += 1;
      }
    }

    await scanWantedEpisodes(mediaTitle.id);
    rescannedWanted += 1;
  }

  return {
    inspected: mediaTitles.length,
    repairedEpisodes,
    movedFiles,
    rescannedWanted,
  };
}

export async function scanWantedEpisodes(mediaTitleId: string) {
  const media = await loadMedia(mediaTitleId);
  if (media.type !== "ANIME" && media.type !== "TV") {
    throw new Error("Wanted episodes are only available for anime and TV titles.");
  }
  const candidates = await findCandidatesForMedia(media);
  const coverage = buildWantedEpisodeCoverage(
    media,
    candidates,
    await prisma.wantedEpisode.findMany({ where: { mediaTitleId } }),
  );
  const changed = [];
  const coverageKeys = new Set(
    coverage.episodes.map((item) => `${item.seasonNumber}:${item.episodeNumber}`),
  );
  const staleConditions = await staleWantedEpisodeConditions(mediaTitleId, coverageKeys);

  if (staleConditions.length > 0) {
    await prisma.wantedEpisode.deleteMany({
      where: {
        mediaTitleId,
        ignored: false,
        OR: staleConditions,
      },
    });
  }

  for (const item of coverage.episodes) {
    if (item.status === "AVAILABLE") {
      await prisma.wantedEpisode.deleteMany({
        where: {
          mediaTitleId,
          seasonNumber: item.seasonNumber,
          episodeNumber: item.episodeNumber,
          ignored: false,
        },
      });
      continue;
    }

    const row = await prisma.wantedEpisode.upsert({
      where: {
        mediaTitleId_seasonNumber_episodeNumber: {
          mediaTitleId,
          seasonNumber: item.seasonNumber,
          episodeNumber: item.episodeNumber,
        },
      },
      create: {
        mediaTitleId,
        seasonNumber: item.seasonNumber,
        episodeNumber: item.episodeNumber,
        status: item.status,
        matchedCandidateId: item.candidateId,
        reason: item.reason,
      },
      update: {
        status: item.status,
        matchedCandidateId: item.candidateId,
        reason: item.reason,
      },
    });
    changed.push(row.id);
  }

  return {
    ...buildWantedEpisodeCoverage(
      media,
      candidates,
      await prisma.wantedEpisode.findMany({ where: { mediaTitleId } }),
    ),
    changed,
  };
}

export async function ignoreWantedEpisode(wantedEpisodeId: string) {
  return prisma.wantedEpisode.update({
    where: { id: wantedEpisodeId },
    data: {
      ignored: true,
      status: "IGNORED",
      reason: "Ignored by user",
    },
  });
}

export async function restoreWantedEpisode(wantedEpisodeId: string) {
  return prisma.wantedEpisode.update({
    where: { id: wantedEpisodeId },
    data: {
      ignored: false,
      status: "MISSING",
      reason: "Restored by user",
    },
  });
}

export async function downloadWantedEpisode(wantedEpisodeId: string) {
  const wanted = await prisma.wantedEpisode.findUniqueOrThrow({
    where: { id: wantedEpisodeId },
  });
  if (!wanted.matchedCandidateId) {
    throw new Error("Wanted episode has no matched candidate.");
  }

  const download = await enqueueCandidateDownload(wanted.matchedCandidateId);
  await prisma.wantedEpisode.update({
    where: { id: wanted.id },
    data: {
      ignored: false,
      status: "DOWNLOADING",
      reason: "Download queued",
    },
  });
  return download;
}

async function loadMedia(mediaTitleId: string) {
  return prisma.mediaTitle.findUniqueOrThrow({
    where: { id: mediaTitleId },
    include: {
      aliases: true,
      seasons: {
        orderBy: { number: "asc" },
        include: {
          episodes: {
            orderBy: { number: "asc" },
            include: {
              files: { select: { id: true, originalName: true } },
            },
          },
        },
      },
    },
  });
}

async function findCandidatesForMedia(media: MediaWithEpisodes) {
  const aliases = mediaAliases(media);
  const candidates = await prisma.releaseCandidate.findMany({
    where: {
      mediaType: media.type,
      groupId: { not: null },
    },
    include: {
      downloads: { select: { status: true } },
      organizerPlans: { select: { status: true, items: { select: { id: true } } } },
      group: { select: { displayTitle: true, normalizedTitle: true, aliases: true } },
    },
    orderBy: [{ episodeNumber: "asc" }, { createdAt: "desc" }],
  });

  return candidates.filter(
    (candidate) => candidateMatchesMedia(candidate, aliases) && candidateMatchesMediaSeason(candidate, media),
  );
}

export function buildWantedEpisodeCoverage(
  media: MediaWithEpisodes,
  candidates: CandidateWithState[],
  wantedRows: Array<{
    id: string;
    seasonNumber: number;
    episodeNumber: number;
    status: WantedEpisodeStatus;
    ignored: boolean;
    matchedCandidateId: string | null;
    reason: string | null;
  }>,
) {
  const relevantCandidates = candidates.filter((candidate) => candidateMatchesMediaSeason(candidate, media));
  const effectiveCandidates = relevantCandidates.map((candidate) => ({
    candidate,
    normalized: normalizeCandidateEpisodeNumber(candidate, relevantCandidates),
  }));
  const wantedMap = new Map(
    wantedRows.map((row) => [`${row.seasonNumber}:${row.episodeNumber}`, row]),
  );
  const seasonNumbers = new Set([
    ...media.seasons.map((season) => season.number),
    ...effectiveCandidates.map((item) => item.normalized.season),
    ...wantedRows
      .filter((row) => row.ignored)
      .map((row) => row.seasonNumber),
  ]);
  const episodes: EpisodeCoverageItem[] = [];

  for (const seasonNumber of [...seasonNumbers].sort((a, b) => a - b)) {
    const season = media.seasons.find((item) => item.number === seasonNumber);
    const seasonEpisodes = normalizeSeasonEpisodes(
      season?.episodes ?? [],
      seasonNumber,
      relevantCandidates,
      [media.primaryTitle, media.originalTitle].filter(Boolean).join(" "),
    );
    const seasonCandidates = effectiveCandidates.filter(
      (item) => item.normalized.season === seasonNumber,
    );
    const maxEpisode = Math.max(
      0,
      ...seasonEpisodes.map((episode) => episode.number),
      ...seasonCandidates.map(candidateKnownMaxEpisode),
      ...wantedRows
        .filter((row) => row.seasonNumber === seasonNumber && row.ignored)
        .map((row) => row.episodeNumber),
    );

    for (let episodeNumber = 1; episodeNumber <= maxEpisode; episodeNumber += 1) {
      const episode = seasonEpisodes.find((item) => item.number === episodeNumber) ?? null;
      const wanted = wantedMap.get(`${seasonNumber}:${episodeNumber}`) ?? null;
      if (episode && episode.files.length > 0) {
        episodes.push({
          seasonNumber,
          episodeNumber,
          status: "AVAILABLE",
          episodeId: episode.id,
          mediaFileCount: episode.files.length,
          wantedId: wanted?.id ?? null,
          candidateId: null,
          candidateTitle: null,
          reason: null,
        });
        continue;
      }

      if (wanted?.ignored) {
        episodes.push({
          seasonNumber,
          episodeNumber,
          status: "IGNORED",
          episodeId: episode?.id ?? null,
          mediaFileCount: episode?.files.length ?? 0,
          wantedId: wanted.id,
          candidateId: wanted.matchedCandidateId,
          candidateTitle: null,
          reason: wanted.reason,
        });
        continue;
      }

      const episodeCandidates = seasonCandidates.filter(
        (item) => item.normalized.episodeNumber === episodeNumber,
      );
      const bestCandidate = selectBestCandidate(episodeCandidates.map((item) => item.candidate));
      const state = bestCandidate
        ? stateForCandidate(bestCandidate, episodeCandidates.length)
        : {
            status: "MISSING" as WantedEpisodeStatus,
            reason: "No candidate found",
          };
      episodes.push({
        seasonNumber,
        episodeNumber,
        status: state.status,
        episodeId: episode?.id ?? null,
        mediaFileCount: episode?.files.length ?? 0,
        wantedId: wanted?.id ?? null,
        candidateId: bestCandidate?.id ?? null,
        candidateTitle: bestCandidate?.rawTitle ?? null,
        reason: state.reason,
      });
    }
  }

  return {
    mediaTitleId: media.id,
    seasons: [...seasonNumbers].sort((a, b) => a - b),
    episodes,
    missingCount: episodes.filter((episode) => episode.status !== "AVAILABLE" && episode.status !== "IGNORED").length,
  };
}

function normalizeSeasonEpisodes(
  episodes: MediaWithEpisodes["seasons"][number]["episodes"],
  seasonNumber: number,
  candidates: CandidateWithState[],
  mediaTitleContext = "",
) {
  const byEpisodeNumber = new Map<number, MediaWithEpisodes["seasons"][number]["episodes"][number]>();
  for (const episode of episodes) {
    const rawTitle = episode.files[0]?.originalName ?? episode.title ?? "";
    const normalized = normalizeCandidateEpisodeNumber(
      {
        rawTitle,
        parsedTitle: [episode.title, mediaTitleContext].filter(Boolean).join(" "),
        normalizedTitle: "",
        season: seasonNumber,
        episodeNumber: episode.number,
      },
      candidates,
    );
    const number = normalized.episodeNumber ?? episode.number;
    const existing = byEpisodeNumber.get(number);
    if (existing) {
      existing.files.push(...episode.files);
      continue;
    }
    byEpisodeNumber.set(number, { ...episode, number, files: [...episode.files] });
  }
  return [...byEpisodeNumber.values()].sort((a, b) => a.number - b.number);
}

function candidateKnownMaxEpisode(input: {
  candidate: CandidateWithState;
  normalized: { episodeNumber: number | null };
}) {
  if (input.normalized.episodeNumber !== null) {
    return input.normalized.episodeNumber;
  }
  return extractBatchEpisodeEnd(input.candidate.rawTitle) ?? 0;
}

function extractBatchEpisodeEnd(value: string) {
  const matches = value.matchAll(
    /(?:^|[\s[\]()【】_-])(?<start>\d{1,3})\s*-\s*(?<end>\d{1,3})(?:\s*(?:fin|end|complete|全集|全))?(?=$|[\s[\]()【】_-])/gi,
  );
  for (const match of matches) {
    const start = Number(match.groups?.start);
    const end = Number(match.groups?.end);
    if (Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end > start && end <= 200) {
      return end;
    }
  }
  return null;
}

function selectBestCandidate(candidates: CandidateWithState[]) {
  return [...candidates].sort(
    (a, b) =>
      candidatePriority(b) - candidatePriority(a) ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  )[0] ?? null;
}

function candidatePriority(candidate: CandidateWithState) {
  if (candidate.downloads.some((download) => ["WAITING", "ACTIVE", "PAUSED"].includes(download.status))) {
    return 50;
  }
  if (candidate.downloads.some((download) => download.status === "COMPLETED")) {
    return 40;
  }
  if (candidate.status === "SUBSCRIBED" || candidate.status === "DOWNLOADED") {
    return 30;
  }
  if (candidate.status === "READY") {
    return 20;
  }
  if (candidate.status === "REVIEW") {
    return 10;
  }
  return 1;
}

function stateForCandidate(candidate: CandidateWithState, candidateCount: number) {
  const activeOrganizerPlans = candidate.organizerPlans.filter((plan) =>
    ["PENDING", "NEEDS_REVIEW", "CONFLICT", "FAILED"].includes(plan.status),
  );
  if (activeOrganizerPlans.some((plan) => plan.items.length > 0)) {
    return { status: "DOWNLOADED" as const, reason: "Downloaded and waiting for organizer" };
  }
  if (candidate.downloads.some((download) => ["WAITING", "ACTIVE", "PAUSED"].includes(download.status))) {
    return { status: "DOWNLOADING" as const, reason: "Download in progress" };
  }
  if (candidate.downloads.some((download) => download.status === "COMPLETED")) {
    return {
      status: "DOWNLOADED" as const,
      reason: activeOrganizerPlans.length > 0
        ? "Download completed but organizer plan has no files; run organizer scan"
        : "Download completed",
    };
  }
  if (candidate.status === "REVIEW" || candidateCount > 1) {
    return { status: "NEEDS_REVIEW" as const, reason: "Multiple or review-required candidates found" };
  }
  return { status: "CANDIDATE_FOUND" as const, reason: "Candidate found" };
}

function candidateMatchesMedia(candidate: CandidateWithState, mediaAliasSet: Set<string>) {
  const values = [
    candidate.normalizedTitle,
    candidate.parsedTitle,
    candidate.group?.displayTitle,
    candidate.group?.normalizedTitle,
    ...groupAliases(candidate.group?.aliases),
  ];
  return values
    .flatMap((value) => normalizeTitleAliases(value ?? ""))
    .some((alias) => mediaAliasSet.has(alias));
}

function candidateMatchesMediaSeason(candidate: CandidateWithState, media: MediaWithEpisodes) {
  const mediaSeasons = new Set(media.seasons.map((season) => season.number));
  if (mediaSeasons.size === 0) {
    return true;
  }
  const candidateSeason = candidate.season ?? 1;
  if (mediaSeasons.has(candidateSeason)) {
    return true;
  }
  return !(candidateSeason === 1 && !mediaSeasons.has(1));
}

function mediaAliases(media: MediaWithEpisodes) {
  return new Set(
    [
      media.primaryTitle,
      media.originalTitle,
      ...media.aliases.map((alias) => alias.title),
      ...media.seasons.flatMap((season) => season.episodes.map((episode) => episode.title ?? "")),
    ].flatMap((value) => normalizeTitleAliases(value ?? "")),
  );
}

async function staleWantedEpisodeConditions(mediaTitleId: string, coverageKeys: Set<string>) {
  const existing = await prisma.wantedEpisode.findMany({
    where: { mediaTitleId, ignored: false },
    select: { seasonNumber: true, episodeNumber: true },
  });
  return existing
    .filter((row) => !coverageKeys.has(`${row.seasonNumber}:${row.episodeNumber}`))
    .map((row) => ({ seasonNumber: row.seasonNumber, episodeNumber: row.episodeNumber }));
}

function groupAliases(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}
