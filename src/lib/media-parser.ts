import type { MediaType } from "@prisma/client";
import { normalizeTitle, parseAnimeReleaseTitle } from "@/lib/anime-parser";

export type IntakeMediaType = MediaType | "AUTO";

export type ParsedMediaRelease = {
  rawTitle: string;
  mediaType: MediaType;
  parsedTitle: string;
  normalizedTitle: string;
  subtitleGroup?: string;
  episodeNumber?: number;
  season?: number;
  year?: number;
  resolution?: string;
  codec?: string;
  audio?: string;
  subtitleLanguage?: string;
  releaseProfile?: string;
  sourceKind?: string;
  variantKey?: string;
  releaseTags: string[];
  confidence: number;
};

const mediaTypes = new Set<MediaType>(["ANIME", "MOVIE", "TV"]);
const resolutionPattern = /\b(2160p|4k|1080p|720p|480p)\b/i;
const codecPattern = /\b(x265|x264|h\.?265|h\.?264|hevc|avc|av1)\b/i;
const audioPattern = /\b(aac|flac|opus|mp3|truehd|dts|ddp?5\.1|ddp?7\.1)\b/i;
const sourcePattern = /\b(web\s?-?dl|webrip|hdtv|bdrip|bdremux|blu\s?-?ray|bluray|netflix|amazon|disney\+|hulu)\b/i;
const animeMoviePattern = /(?:劇場版|剧场版|映画|the\s+movie|\bmovie\b|\bfilm\b|\btheatrical\b)/i;
const tvPatterns = [
  /\bS(?<season>\d{1,2})E(?<episode>\d{1,4})(?:\b|[^\d])/i,
  /\b(?<season>\d{1,2})x(?<episode>\d{1,4})\b/i,
];
const animeEpisodeSignalPattern =
  /(?:\bS\d{1,2}E\d{1,4}\b|\bEP?\s?\d{1,4}\b|第\s?\d{1,4}\s?[话話集]|(?:^|[\s_\-[({])\d{1,3}(?:v\d)?(?:$|[\s_\-\])}]))/i;

export function normalizeIntakeMediaType(value: unknown): IntakeMediaType {
  if (value === "AUTO") {
    return "AUTO";
  }
  if (typeof value === "string" && mediaTypes.has(value as MediaType)) {
    return value as MediaType;
  }
  throw new Error("mediaType must be ANIME, MOVIE, TV, or AUTO");
}

export function resolveMediaType(rawTitle: string, requested: IntakeMediaType): MediaType {
  if (requested === "ANIME" && looksAnimeMovie(rawTitle)) {
    return "MOVIE";
  }
  if (requested !== "AUTO") {
    return requested;
  }
  return detectMediaType(rawTitle);
}

export function detectMediaType(rawTitle: string): MediaType {
  if (tvPatterns.some((pattern) => pattern.test(rawTitle))) {
    return "TV";
  }
  if (looksAnimeMovie(rawTitle)) {
    return "MOVIE";
  }
  if (/\b(19\d{2}|20\d{2})\b/.test(rawTitle) && !looksAnime(rawTitle)) {
    return "MOVIE";
  }
  return "ANIME";
}

export function parseMediaReleaseTitle(
  rawTitle: string,
  requestedMediaType: IntakeMediaType = "ANIME",
): ParsedMediaRelease {
  const mediaType = resolveMediaType(rawTitle, requestedMediaType);
  if (mediaType === "ANIME") {
    return { ...parseAnimeReleaseTitle(rawTitle), mediaType };
  }
  if (mediaType === "TV") {
    return parseTvReleaseTitle(rawTitle);
  }
  return parseMovieReleaseTitle(rawTitle);
}

function parseTvReleaseTitle(rawTitle: string): ParsedMediaRelease {
  const common = parseCommonReleaseInfo(rawTitle);
  const tvMatch = tvPatterns
    .map((pattern) => rawTitle.match(pattern))
    .find((match) => match?.groups?.episode);
  const season = Number(tvMatch?.groups?.season ?? 1);
  const episodeNumber = Number(tvMatch?.groups?.episode ?? 1);
  const parsedTitle = cleanReleaseTitle(
    rawTitle
      .replace(tvPatterns[0], " ")
      .replace(tvPatterns[1], " ")
      .replace(/\b(19\d{2}|20\d{2})\b/, " "),
  );
  const signals = [
    parsedTitle.length > 0,
    Boolean(tvMatch),
    Boolean(common.resolution),
    Boolean(common.sourceKind),
  ].filter(Boolean).length;

  return {
    ...common,
    mediaType: "TV",
    parsedTitle: parsedTitle || rawTitle,
    normalizedTitle: normalizeTitle(parsedTitle || rawTitle),
    episodeNumber,
    season,
    confidence: Math.min(0.92, 0.35 + signals * 0.14),
  };
}

function parseMovieReleaseTitle(rawTitle: string): ParsedMediaRelease {
  const common = parseCommonReleaseInfo(rawTitle);
  const year = extractYear(rawTitle);
  const parsedTitle = cleanReleaseTitle(rawTitle.replace(/\b(19\d{2}|20\d{2})\b/, " "));
  const signals = [
    parsedTitle.length > 0,
    Boolean(year),
    Boolean(common.resolution),
    Boolean(common.sourceKind),
  ].filter(Boolean).length;

  return {
    ...common,
    mediaType: "MOVIE",
    parsedTitle: parsedTitle || rawTitle,
    normalizedTitle: normalizeTitle(parsedTitle || rawTitle),
    season: 1,
    episodeNumber: 1,
    year,
    confidence: Math.min(0.9, 0.34 + signals * 0.14),
  };
}

function parseCommonReleaseInfo(rawTitle: string) {
  const searchableTitle = rawTitle.replace(/[_.-]+/g, " ");
  const releaseTags = [...rawTitle.matchAll(/\[([^\]]+)\]|【([^】]+)】|\(([^)]+)\)/g)]
    .map((match) => match[1] || match[2] || match[3])
    .filter(Boolean);
  const resolution = searchableTitle.match(resolutionPattern)?.[1]?.replace(/^4k$/i, "2160p");
  const codec = searchableTitle.match(codecPattern)?.[1]?.toUpperCase().replace(".", "");
  const audio = searchableTitle.match(audioPattern)?.[1]?.toUpperCase();
  const sourceKind = normalizeSourceKind(searchableTitle.match(sourcePattern)?.[1]);
  const releaseProfile = [sourceKind, ...releaseTags.filter((tag) => !isTechnicalTag(tag))]
    .filter(Boolean)
    .join(" / ") || undefined;

  return {
    rawTitle,
    resolution,
    codec,
    audio,
    sourceKind,
    releaseProfile,
    releaseTags,
    variantKey: [
      releaseProfile,
      sourceKind,
      resolution,
      codec,
      audio,
    ]
      .map((value) => normalizeAtom(value ?? ""))
      .filter(Boolean)
      .join("|") || undefined,
  };
}

function cleanReleaseTitle(value: string) {
  return value
    .replace(/\.(?:mkv|mp4|avi|mov|webm|m4v|ts)$/i, " ")
    .replace(/\[[^\]]+\]|【[^】]+】|\([^)]+\)/g, " ")
    .replace(resolutionPattern, " ")
    .replace(codecPattern, " ")
    .replace(audioPattern, " ")
    .replace(sourcePattern, " ")
    .replace(/\b(complete|proper|repack|multi|internal|remux|extended|theatrical)\b/gi, " ")
    .replace(/[._-]+/g, " ")
    .replace(/\b(?:mkv|mp4|avi|mov|webm|m4v|ts)\b$/i, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractYear(value: string) {
  const year = Number(value.match(/\b(?<year>19\d{2}|20\d{2})\b/)?.groups?.year);
  return Number.isFinite(year) ? year : undefined;
}

function normalizeSourceKind(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const normalized = value.toLowerCase().replace(/[\s-]+/g, "");
  if (normalized === "webdl") {
    return "WEB-DL";
  }
  if (normalized === "bluray" || normalized === "bluray") {
    return "Blu-ray";
  }
  if (normalized === "bdrip") {
    return "BDRip";
  }
  if (normalized === "bdremux") {
    return "BDRemux";
  }
  if (normalized === "webrip") {
    return "WEBRip";
  }
  if (normalized === "hdtv") {
    return "HDTV";
  }
  if (normalized === "netflix") {
    return "Netflix";
  }
  if (normalized === "amazon") {
    return "Amazon";
  }
  if (normalized === "disney+") {
    return "Disney+";
  }
  return value;
}

function looksAnime(value: string) {
  return /简体|繁体|简繁|内嵌|外挂|番组|字幕组|mikan|baha|b-global|bilibili/i.test(value);
}

function looksAnimeMovie(value: string) {
  return animeMoviePattern.test(value) && !animeEpisodeSignalPattern.test(value);
}

function isTechnicalTag(value: string) {
  return /^(2160p|4k|1080p|720p|480p|x265|x264|h265|h264|hevc|avc|av1|aac|flac|opus|web-?dl|webrip|hdtv|blu-?ray|bluray|bdrip|bdremux)$/i.test(
    value.trim(),
  );
}

function normalizeAtom(value: string) {
  return value
    .toLowerCase()
    .replace(/\[[^\]]+\]|\([^)]+\)|【[^】]+】/g, " ")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
