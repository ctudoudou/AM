import type { MediaTitle, ReleaseCandidate, WantedEpisodeStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeTitleAliases } from "@/lib/anime-parser";
import { enqueueCandidateDownload } from "@/lib/downloads";

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
      files: Array<{ id: string }>;
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
  const media = await loadMedia(mediaTitleId);
  const candidates = await findCandidatesForMedia(media);
  const wanted = await prisma.wantedEpisode.findMany({
    where: { mediaTitleId },
  });
  return buildWantedEpisodeCoverage(media, candidates, wanted);
}

export async function scanWantedEpisodes(mediaTitleId: string) {
  const media = await loadMedia(mediaTitleId);
  const candidates = await findCandidatesForMedia(media);
  const coverage = buildWantedEpisodeCoverage(
    media,
    candidates,
    await prisma.wantedEpisode.findMany({ where: { mediaTitleId } }),
  );
  const changed = [];

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
              files: { select: { id: true } },
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
      episodeNumber: { not: null },
      groupId: { not: null },
    },
    include: {
      downloads: { select: { status: true } },
      organizerPlans: { select: { status: true, items: { select: { id: true } } } },
      group: { select: { displayTitle: true, normalizedTitle: true, aliases: true } },
    },
    orderBy: [{ episodeNumber: "asc" }, { createdAt: "desc" }],
  });

  return candidates.filter((candidate) => candidateMatchesMedia(candidate, aliases));
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
  const wantedMap = new Map(
    wantedRows.map((row) => [`${row.seasonNumber}:${row.episodeNumber}`, row]),
  );
  const seasonNumbers = new Set([
    ...media.seasons.map((season) => season.number),
    ...candidates.map((candidate) => candidate.season ?? 1),
    ...wantedRows.map((row) => row.seasonNumber),
  ]);
  const episodes: EpisodeCoverageItem[] = [];

  for (const seasonNumber of [...seasonNumbers].sort((a, b) => a - b)) {
    const season = media.seasons.find((item) => item.number === seasonNumber);
    const seasonCandidates = candidates.filter((candidate) => (candidate.season ?? 1) === seasonNumber);
    const maxEpisode = Math.max(
      0,
      ...((season?.episodes ?? []).map((episode) => episode.number)),
      ...seasonCandidates.map((candidate) => Math.floor(candidate.episodeNumber ?? 0)),
      ...wantedRows
        .filter((row) => row.seasonNumber === seasonNumber)
        .map((row) => row.episodeNumber),
    );

    for (let episodeNumber = 1; episodeNumber <= maxEpisode; episodeNumber += 1) {
      const episode = season?.episodes.find((item) => item.number === episodeNumber) ?? null;
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
        (candidate) => Math.floor(candidate.episodeNumber ?? 0) === episodeNumber,
      );
      const bestCandidate = selectBestCandidate(episodeCandidates);
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

function groupAliases(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}
