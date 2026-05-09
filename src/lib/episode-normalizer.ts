import { parseMediaReleaseTitle } from "@/lib/media-parser";

export type EpisodeNumberCandidate = {
  id?: string;
  rawTitle: string;
  parsedTitle?: string | null;
  normalizedTitle?: string | null;
  season?: number | null;
  episodeNumber?: number | null;
};

export type EpisodeNumberNormalization = {
  season: number;
  episodeNumber: number | null;
  rawEpisodeNumber: number | null;
  offset: number;
};

const maxTypicalSeasonEpisodes = 30;
const minCumulativeOffset = 8;

export function normalizeCandidateEpisodeNumber(
  candidate: EpisodeNumberCandidate,
  candidates: EpisodeNumberCandidate[] = [candidate],
): EpisodeNumberNormalization {
  const season = positiveInteger(candidate.season) ?? 1;
  const rawEpisodeNumber = positiveInteger(candidate.episodeNumber);
  if (rawEpisodeNumber === null) {
    return { season, episodeNumber: null, rawEpisodeNumber: null, offset: 0 };
  }

  const offset =
    inferEpisodeOffsetForSeason(candidates, season, candidate) ??
    inferCourEpisodeOffset(candidate, season, rawEpisodeNumber) ??
    inferTwelveEpisodeWindowOffset(candidate, rawEpisodeNumber) ??
    inferTwelveEpisodeSeasonOffset(candidate, season, rawEpisodeNumber) ??
    0;
  const episodeNumber = rawEpisodeNumber - offset;

  return {
    season,
    episodeNumber: episodeNumber > 0 ? episodeNumber : rawEpisodeNumber,
    rawEpisodeNumber,
    offset: episodeNumber > 0 ? offset : 0,
  };
}

export function normalizeParsedReleaseEpisode(input: {
  rawTitle: string;
  parsedTitle?: string | null;
  season?: number | null;
  episodeNumber?: number | null;
  candidates?: EpisodeNumberCandidate[];
}) {
  return normalizeCandidateEpisodeNumber(
    {
      rawTitle: input.rawTitle,
      parsedTitle: input.parsedTitle,
      season: input.season,
      episodeNumber: input.episodeNumber,
    },
    input.candidates,
  );
}

export function parseTargetPathEpisodeIdentity(targetPath: string) {
  const match = targetPath.match(/\bS(?<season>\d{1,2})E(?<episode>\d{1,4})\b/i);
  const season = positiveInteger(match?.groups?.season);
  const episodeNumber = positiveInteger(match?.groups?.episode);
  return season && episodeNumber ? { season, episodeNumber } : null;
}

function inferEpisodeOffsetForSeason(
  candidates: EpisodeNumberCandidate[],
  season: number,
  target: EpisodeNumberCandidate,
) {
  const targetEpisode = positiveInteger(target.episodeNumber);
  if (targetEpisode === null || targetEpisode <= maxTypicalSeasonEpisodes) {
    return null;
  }

  const episodeNumbers = candidates
    .filter((candidate) => (positiveInteger(candidate.season) ?? 1) === season)
    .map((candidate) => positiveInteger(candidate.episodeNumber))
    .filter((episode): episode is number => episode !== null);
  const relativeEpisodes = new Set(
    episodeNumbers.filter((episode) => episode >= 1 && episode <= maxTypicalSeasonEpisodes),
  );
  const cumulativeEpisodes = episodeNumbers.filter(
    (episode) => episode > maxTypicalSeasonEpisodes,
  );
  if (relativeEpisodes.size === 0 || cumulativeEpisodes.length === 0) {
    return null;
  }

  const offsetScores = new Map<number, number>();
  for (const cumulativeEpisode of cumulativeEpisodes) {
    for (const relativeEpisode of relativeEpisodes) {
      const offset = cumulativeEpisode - relativeEpisode;
      if (
        offset >= minCumulativeOffset &&
        cumulativeEpisode - offset >= 1 &&
        cumulativeEpisode - offset <= maxTypicalSeasonEpisodes
      ) {
        offsetScores.set(offset, (offsetScores.get(offset) ?? 0) + 1);
      }
    }
  }

  const best = [...offsetScores.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
  if (!best) {
    return null;
  }
  const [offset, support] = best;
  const normalizedTarget = targetEpisode - offset;
  if (support >= 2 && normalizedTarget >= 1 && normalizedTarget <= maxTypicalSeasonEpisodes) {
    return offset;
  }
  return null;
}

function inferCourEpisodeOffset(
  candidate: EpisodeNumberCandidate,
  season: number,
  episodeNumber: number,
) {
  const cour = extractCourNumber([candidate.rawTitle, candidate.parsedTitle].join(" "));
  if (!cour || cour <= 1) {
    return null;
  }
  const offset = (cour - 1) * 12;
  const normalized = episodeNumber - offset;
  return normalized >= 1 && normalized <= maxTypicalSeasonEpisodes ? offset : null;
}

function inferTwelveEpisodeSeasonOffset(
  candidate: EpisodeNumberCandidate,
  season: number,
  episodeNumber: number,
) {
  if (season <= 1 || episodeNumber <= maxTypicalSeasonEpisodes || !hasExplicitSeasonQualifier(candidate)) {
    return null;
  }
  const offset = (season - 1) * 12;
  const normalized = episodeNumber - offset;
  return normalized >= 1 && normalized <= maxTypicalSeasonEpisodes ? offset : null;
}

function inferTwelveEpisodeWindowOffset(
  candidate: EpisodeNumberCandidate,
  episodeNumber: number,
) {
  if (episodeNumber <= 12 || !hasExplicitSeasonQualifier(candidate)) {
    return null;
  }
  const offset = Math.floor((episodeNumber - 1) / 12) * 12;
  const normalized = episodeNumber - offset;
  return offset >= minCumulativeOffset && normalized >= 1 && normalized <= 12 ? offset : null;
}

function hasExplicitSeasonQualifier(candidate: EpisodeNumberCandidate) {
  return /(?:第\s*[一二三四五六七八九十\d]+\s*(?:季|期|シリーズ|クール)|\b\d{1,2}(?:st|nd|rd|th)\s+season\b|\bseason\s*\d{1,2}\b|\bs\d{1,2}\b|\b(?:part|cour)\s*\d{1,2}\b)/i.test(
    [candidate.rawTitle, candidate.parsedTitle].join(" "),
  );
}

function extractCourNumber(value: string) {
  const match =
    value.match(/第\s*(?<cour>[一二三四五六七八九十\d]+)\s*クール/i) ??
    value.match(/\b(?:cour|part)\s*(?<cour>\d{1,2})\b/i);
  const raw = match?.groups?.cour;
  return raw ? parseOrdinalNumber(raw) : null;
}

function positiveInteger(value: unknown) {
  const number = typeof value === "number" ? Math.floor(value) : Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function parseOrdinalNumber(value: string) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  const numerals: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  if (value === "十") {
    return 10;
  }
  if (value.startsWith("十")) {
    return 10 + (numerals[value.at(1) ?? ""] ?? 0);
  }
  if (value.endsWith("十")) {
    return (numerals[value.at(0) ?? ""] ?? 1) * 10;
  }
  if (value.includes("十")) {
    const [tens, ones] = value.split("十");
    return (numerals[tens] ?? 1) * 10 + (numerals[ones] ?? 0);
  }
  return numerals[value] ?? null;
}

export function parseReleaseWithNormalizedEpisode(
  rawTitle: string,
  candidates?: EpisodeNumberCandidate[],
) {
  const parsed = parseMediaReleaseTitle(rawTitle, "ANIME");
  const normalized = normalizeParsedReleaseEpisode({
    rawTitle,
    parsedTitle: parsed.parsedTitle,
    season: parsed.season,
    episodeNumber: parsed.episodeNumber,
    candidates,
  });
  return {
    ...parsed,
    season: normalized.season,
    episodeNumber: normalized.episodeNumber ?? parsed.episodeNumber,
    rawEpisodeNumber: normalized.rawEpisodeNumber,
    episodeOffset: normalized.offset,
  };
}
