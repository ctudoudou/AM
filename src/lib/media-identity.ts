import type { MediaType } from "@prisma/client";
import { normalizeTitleAliases } from "@/lib/anime-parser";

export type MediaIdentityInput = {
  mediaType?: MediaType | string | null;
  title?: string | null;
  displayTitle?: string | null;
  normalizedTitle?: string | null;
  parsedTitle?: string | null;
  rawTitle?: string | null;
  aliases?: unknown;
  season?: number | null;
};

export type MediaIdentity = {
  mediaType: MediaType | string | null;
  season: number | null;
  primaryKey: string | null;
  keys: string[];
};

export type SubscriptionCoverageInput = MediaIdentityInput & {
  seasonMode?: string | null;
  seasonNumber?: number | null;
  candidateGroup?: MediaIdentityInput | null;
};

export type PreparedSubscriptionCoverage = {
  mediaType: MediaType | string | null;
  seasonMode: string | null;
  seasonNumber: number | null;
  titleIdentity: MediaIdentity;
  boundGroupDisplayIdentity: MediaIdentity | null;
  titleMatchesBoundGroup: boolean;
};

const releaseNoisePattern =
  /\b(?:2160p|4k|1080p|720p|480p|x265|x264|h\.?265|h\.?264|hevc|avc|av1|aac|flac|opus|mp3|web-?dl|webrip|bdrip|baha|b-global|cr|crunchyroll|netflix|amazon|mikanani|gb|big5|chs|cht|sc|tc|cn|jpn|japanese|eng|english|ready)\b/gi;
const batchNoisePattern =
  /(?:^|[\s/|｜／-])\d{1,4}(?:\.\d+)?\s*[-~～]\s*\d{1,4}(?:\.\d+)?\s*(?:精校|全修正|修正)?(?:合集|全集|全|完|完结|完結|fin|final|end)?(?:$|[\s/|｜／-])/gi;
const episodeNoisePattern =
  /(?:^|[\s/|｜／-])(?:ep?\s*)?\d{1,4}(?:\.\d+)?(?:v\d+)?(?:$|[\s/|｜／-])/gi;
const movieNoisePattern = /(?:^|\s)(?:剧场版|劇場版|映画|the\s+movie|movie|film|电影)(?:$|\s)/gi;

export function createMediaIdentity(input: MediaIdentityInput): MediaIdentity {
  const keys = createMediaIdentityKeys(input);
  return {
    mediaType: input.mediaType ?? null,
    season: normalizeSeason(input.season),
    primaryKey: keys[0] ?? null,
    keys,
  };
}

export function createMediaIdentityKeys(input: MediaIdentityInput) {
  const season = normalizeSeason(input.season);
  const aliases = collectIdentityTexts(input)
    .flatMap((text) => splitIdentityText(text))
    .flatMap((text) => normalizeIdentityText(text, season, input.mediaType))
    .filter(isUsefulIdentityKey);

  return [...new Set(aliases)].sort(compareIdentityKeys);
}

export function mediaIdentitiesOverlap(left: MediaIdentityInput, right: MediaIdentityInput) {
  return preparedMediaIdentitiesOverlap(createMediaIdentity(left), createMediaIdentity(right));
}

export function prepareSubscriptionCoverage(
  subscription: SubscriptionCoverageInput,
): PreparedSubscriptionCoverage {
  const titleIdentity = createMediaIdentity(subscriptionTitleIdentity(subscription));
  const boundGroupDisplayIdentity = subscription.candidateGroup
    ? createMediaIdentity({ ...subscription.candidateGroup, aliases: [] })
    : null;
  return {
    mediaType: subscription.mediaType ?? null,
    seasonMode: subscription.seasonMode ?? null,
    seasonNumber: normalizeSeason(subscription.seasonNumber),
    titleIdentity,
    boundGroupDisplayIdentity,
    titleMatchesBoundGroup: Boolean(
      boundGroupDisplayIdentity &&
      preparedMediaIdentitiesOverlap(titleIdentity, boundGroupDisplayIdentity),
    ),
  };
}

export function preparedSubscriptionCoversCandidateGroup(
  subscription: PreparedSubscriptionCoverage,
  group: MediaIdentity,
) {
  if (subscription.mediaType && group.mediaType && subscription.mediaType !== group.mediaType) {
    return false;
  }
  if (!preparedSubscriptionSeasonCoversGroup(subscription, group)) {
    return false;
  }
  if (preparedMediaIdentitiesOverlap(subscription.titleIdentity, group)) {
    return true;
  }
  return Boolean(
    subscription.titleMatchesBoundGroup &&
    subscription.boundGroupDisplayIdentity &&
    preparedMediaIdentitiesOverlap(subscription.boundGroupDisplayIdentity, group),
  );
}

export function subscriptionCoversCandidateGroup(
  subscription: SubscriptionCoverageInput,
  group: MediaIdentityInput,
) {
  return preparedSubscriptionCoversCandidateGroup(
    prepareSubscriptionCoverage(subscription),
    createMediaIdentity(group),
  );
}

export function subscriptionTitleIdentity(subscription: SubscriptionCoverageInput): MediaIdentityInput {
  return {
    mediaType: subscription.mediaType,
    title: subscription.title,
    displayTitle: subscription.displayTitle,
    normalizedTitle: subscription.normalizedTitle,
    aliases: subscription.aliases,
    season: subscription.seasonNumber ?? subscription.season ?? subscription.candidateGroup?.season ?? null,
  };
}

export function identityKeysOverlap(leftKeys: string[], rightKeys: string[]) {
  return leftKeys.some((left) =>
    rightKeys.some((right) => left === right || keysContainSameTitle(left, right)),
  );
}

export function seasonsCompatible(left: MediaIdentityInput, right: MediaIdentityInput) {
  const leftSeason = normalizeSeason(left.season);
  const rightSeason = normalizeSeason(right.season);
  if (leftSeason === null || rightSeason === null) {
    return true;
  }
  return leftSeason === rightSeason;
}

function preparedMediaIdentitiesOverlap(left: MediaIdentity, right: MediaIdentity) {
  if (left.mediaType && right.mediaType && left.mediaType !== right.mediaType) {
    return false;
  }
  if (!preparedSeasonsCompatible(left.season, right.season)) {
    return false;
  }
  return identityKeysOverlap(left.keys, right.keys);
}

function preparedSubscriptionSeasonCoversGroup(
  subscription: PreparedSubscriptionCoverage,
  group: MediaIdentity,
) {
  if (subscription.seasonMode === "specific") {
    return (
      subscription.seasonNumber === null ||
      group.season === null ||
      subscription.seasonNumber === group.season
    );
  }
  return preparedSeasonsCompatible(subscription.titleIdentity.season, group.season);
}

function preparedSeasonsCompatible(left: number | null, right: number | null) {
  return left === null || right === null || left === right;
}

export function jsonStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function collectIdentityTexts(input: MediaIdentityInput) {
  return [
    input.title,
    input.displayTitle,
    input.normalizedTitle,
    input.parsedTitle,
    input.rawTitle,
    ...jsonStringList(input.aliases),
  ].filter((text): text is string => Boolean(text?.trim()));
}

function splitIdentityText(text: string) {
  return text
    .replace(/(?<=[\u3400-\u9fff])_(?=[A-Za-z0-9])/g, " / ")
    .replace(/(?<=[A-Za-z0-9])_(?=[\u3400-\u9fff])/g, " / ")
    .split(/\s*[\/／|｜]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeIdentityText(text: string, season: number | null, mediaType?: string | null) {
  const cleaned = cleanIdentityText(text, mediaType);
  return normalizeTitleAliases(cleaned)
    .map((key) => stripLooseSeasonSuffix(key, season))
    .map((key) => stripGenericReleaseWords(key, mediaType))
    .map((key) => key.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function cleanIdentityText(text: string, mediaType?: string | null) {
  let cleaned = text
    .normalize("NFKC")
    .replace(/\[[^\]]+\]|【[^】]+】/g, " ")
    .replace(/（([^）]+)）|\(([^)]+)\)/g, (_match, fullWidthContent, asciiContent) => {
      const content = fullWidthContent || asciiContent || "";
      return looksLikeReleaseMetadata(content) ? " " : ` ${content} `;
    })
    .replace(batchNoisePattern, " ")
    .replace(releaseNoisePattern, " ")
    .replace(/\bS\d{1,2}E\d{1,4}(?:\.\d+)?\b/gi, " ")
    .replace(/\bEP?\s*\d{1,4}(?:\.\d+)?\b/gi, " ")
    .replace(/第\s*\d{1,4}(?:\.\d+)?\s*(?:话|話|集)/g, " ")
    .replace(/[._]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (mediaType === "MOVIE") {
    cleaned = cleaned.replace(movieNoisePattern, " ").replace(/\s+/g, " ").trim();
  }

  return cleaned;
}

function stripLooseSeasonSuffix(value: string, season: number | null) {
  if (!season) {
    return value;
  }
  const escapedSeason = String(season).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value
    .replace(new RegExp(`(?:^|\\\\s)(?:s${escapedSeason}|season\\\\s*${escapedSeason}|第\\\\s*${escapedSeason}\\\\s*季)$`, "i"), " ")
    .replace(new RegExp(`(?<=[\\u3400-\\u9fff])${escapedSeason}$`), "")
    .replace(new RegExp(`\\\\s+${escapedSeason}$`), "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripGenericReleaseWords(value: string, mediaType?: string | null) {
  let stripped = value
    .replace(/\b(?:on air version|broadcast version|complete)\b/gi, " ")
    .replace(/(?:放送版|先行版|先行放送版|合集|全集)/g, " ")
    .replace(/\b(?:gb|cn|chs|cht|sc|tc|baha|web dl|webrip)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (mediaType === "MOVIE") {
    stripped = stripped
      .replace(/^(?:剧场版|劇場版|映画)\s*/i, "")
      .replace(/\s*(?:电影|movie|film)$/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  return stripped;
}

function looksLikeReleaseMetadata(value: string) {
  const normalized = value.trim();
  releaseNoisePattern.lastIndex = 0;
  batchNoisePattern.lastIndex = 0;
  episodeNoisePattern.lastIndex = 0;
  return (
    releaseNoisePattern.test(normalized) ||
    batchNoisePattern.test(normalized) ||
    episodeNoisePattern.test(normalized) ||
    /^(?:cr|baha|web|web-dl|webrip|tv|bd|bdrip|mp4|mkv|chs|cht|gb|big5)$/i.test(normalized)
  );
}

function normalizeSeason(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function compareIdentityKeys(left: string, right: string) {
  const leftHasCjk = /[\u3400-\u9fff]/.test(left);
  const rightHasCjk = /[\u3400-\u9fff]/.test(right);
  if (leftHasCjk !== rightHasCjk) {
    return leftHasCjk ? -1 : 1;
  }
  return left.length - right.length || left.localeCompare(right);
}

function keysContainSameTitle(left: string, right: string) {
  if (left.length < 5 || right.length < 5) {
    return false;
  }
  return left.includes(right) || right.includes(left);
}

function isUsefulIdentityKey(key: string) {
  if (/[\u3400-\u9fff]/.test(key)) {
    return /[\u3400-\u9fff]{2,}/.test(key);
  }

  if (/^[\d\s+._-]*(?:s|sp|spx|ova|oad|special)?\d*[\d\s+._-]*$/i.test(key)) {
    return false;
  }

  const latinLetters = key.match(/[a-z]/gi)?.length ?? 0;
  return latinLetters >= 5;
}
