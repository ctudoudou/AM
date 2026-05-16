import { parseMediaReleaseTitle, type ParsedMediaRelease } from "@/lib/media-parser";
import {
  normalizeCandidateEpisodeNumber,
  type EpisodeNumberCandidate,
} from "@/lib/episode-normalizer";

export type EpisodeNumberingScheme =
  | "season_relative"
  | "absolute_series"
  | "cour_relative"
  | "part_relative"
  | "batch_range"
  | "unknown";

export type EpisodeIdentity = {
  targetSeason: number;
  targetEpisode: number;
  rawSeason: number | null;
  rawEpisode: number | null;
  normalizedSeason: number;
  normalizedEpisode: number | null;
  numberingScheme: EpisodeNumberingScheme;
  episodeOffset: number;
  confidence: number;
  requiresReview: boolean;
  safeForAutoDownload: boolean;
  evidence: string[];
};

export function analyzeEpisodeIdentity(input: {
  rawTitle: string;
  targetSeason: number;
  targetEpisode: number;
  parsed?: ParsedMediaRelease;
  siblingCandidates?: EpisodeNumberCandidate[];
}): EpisodeIdentity {
  const parsed = input.parsed ?? parseMediaReleaseTitle(input.rawTitle, "ANIME");
  const rawEpisode = positiveInteger(parsed.episodeNumber);
  const rawSeason = positiveInteger(parsed.season);
  const batchRange = extractEpisodeRange(input.rawTitle);
  const hasCour = hasCourSignal(input.rawTitle);
  const hasPart = hasPartSignal(input.rawTitle);
  const evidence: string[] = [];

  if (rawSeason !== null) {
    evidence.push(`raw season ${rawSeason}`);
  }
  if (rawEpisode !== null) {
    evidence.push(`raw episode ${rawEpisode}`);
  }
  if (batchRange) {
    evidence.push(`batch ${batchRange.start}-${batchRange.end}`);
  }
  if (hasCour) {
    evidence.push("cour signal");
  }
  if (hasPart) {
    evidence.push("part signal");
  }

  const normalized = rawEpisode
    ? normalizeCandidateEpisodeNumber(
        {
          rawTitle: input.rawTitle,
          parsedTitle: parsed.parsedTitle,
          normalizedTitle: parsed.normalizedTitle,
          season: input.targetSeason,
          episodeNumber: rawEpisode,
        },
        input.siblingCandidates,
      )
    : {
        season: input.targetSeason,
        episodeNumber: null,
        rawEpisodeNumber: null,
        offset: 0,
      };

  const numberingScheme = inferNumberingScheme({
    batchRange,
    hasCour,
    hasPart,
    normalizedOffset: normalized.offset,
    rawEpisode,
    targetEpisode: input.targetEpisode,
  });

  const explicitSeasonConflicts =
    rawSeason !== null &&
    rawSeason !== input.targetSeason &&
    !hasCour &&
    !hasPart;
  const episodeMatches = normalized.episodeNumber === input.targetEpisode;
  const rawEpisodeMatches = rawEpisode === input.targetEpisode;
  const batchCoversTarget =
    Boolean(batchRange) &&
    input.targetEpisode >= batchRange!.start &&
    input.targetEpisode <= batchRange!.end;
  const requiresReview =
    rawEpisode === null ||
    explicitSeasonConflicts ||
    numberingScheme === "batch_range" ||
    numberingScheme === "absolute_series" ||
    numberingScheme === "cour_relative" ||
    numberingScheme === "part_relative" ||
    !episodeMatches;

  const safeForAutoDownload =
    !requiresReview &&
    rawEpisodeMatches &&
    episodeMatches &&
    (rawSeason === null || rawSeason === input.targetSeason);

  let confidence = safeForAutoDownload ? 0.92 : 0.46;
  if (explicitSeasonConflicts) {
    confidence = 0.12;
    evidence.push(`season conflict: target ${input.targetSeason}`);
  } else if (numberingScheme === "absolute_series" && episodeMatches) {
    confidence = 0.64;
    evidence.push(`offset ${normalized.offset}`);
  } else if (batchCoversTarget) {
    confidence = 0.58;
    evidence.push("target episode covered by batch");
  } else if (episodeMatches) {
    confidence = Math.max(confidence, 0.7);
  }

  return {
    targetSeason: input.targetSeason,
    targetEpisode: input.targetEpisode,
    rawSeason,
    rawEpisode,
    normalizedSeason: input.targetSeason,
    normalizedEpisode: normalized.episodeNumber,
    numberingScheme,
    episodeOffset: normalized.offset,
    confidence,
    requiresReview,
    safeForAutoDownload,
    evidence,
  };
}

function inferNumberingScheme(input: {
  batchRange: { start: number; end: number } | null;
  hasCour: boolean;
  hasPart: boolean;
  normalizedOffset: number;
  rawEpisode: number | null;
  targetEpisode: number;
}): EpisodeNumberingScheme {
  if (input.batchRange) {
    return "batch_range";
  }
  if (input.hasCour) {
    return "cour_relative";
  }
  if (input.hasPart) {
    return "part_relative";
  }
  if (input.normalizedOffset > 0 || (input.rawEpisode ?? 0) !== input.targetEpisode) {
    return input.rawEpisode === null ? "unknown" : "absolute_series";
  }
  return input.rawEpisode === input.targetEpisode ? "season_relative" : "unknown";
}

function extractEpisodeRange(value: string) {
  const match = value.match(
    /(?:^|[\s[\]()【】_-])(?<start>\d{1,3})\s*[-~～]\s*(?<end>\d{1,3})(?:\s*(?:fin|end|complete|全集|全))?(?=$|[\s[\]()【】_-])/i,
  );
  const start = positiveInteger(match?.groups?.start);
  const end = positiveInteger(match?.groups?.end);
  return start && end && end > start ? { start, end } : null;
}

function hasCourSignal(value: string) {
  return /第\s*[一二三四五六七八九十\d]+\s*クール|\bcour\s*\d{1,2}\b/i.test(value);
}

function hasPartSignal(value: string) {
  return /\bpart\s*\d{1,2}\b/i.test(value);
}

function positiveInteger(value: unknown) {
  const number = typeof value === "number" ? Math.floor(value) : Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}
