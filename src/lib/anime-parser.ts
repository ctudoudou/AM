import * as OpenCC from "opencc-js";

export type ParsedAnimeRelease = {
  rawTitle: string;
  parsedTitle: string;
  normalizedTitle: string;
  subtitleGroup?: string;
  episodeNumber?: number;
  season?: number;
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

const resolutionPattern = /\b(2160p|4k|1080p|720p|480p|(?:3840|1920|1280|854|720)x(?:2160|1080|720|480))\b/i;
const codecPattern = /\b(x265|x264|h\.?265|h\.?264|hevc|avc|av1)\b/i;
const audioPattern = /\b(aac|flac|opus|mp3|truehd|dts)\b/i;
const subtitlePattern = /(简繁日内封|简日内嵌|繁日内嵌|简繁内嵌|简繁外挂|简体|繁体|简繁|chs|cht|sc|tc|gb|big5)/i;
const sourcePattern = /\b(web-?dl|webrip|baha|cr|crunchyroll|abema|b-global|netflix|amazon|bilibili|tv|bd|blu-?ray)\b/i;
const videoExtensionPattern = /\.(mkv|mp4|avi|mov|webm|m4v|ts)$/i;
const releaseEditionPattern =
  /(?:^|[\s（(【\[])(?:放送版|オンエア版|先行放送版|先行版|無修正版|修正版|on[\s-]?air\s+version|broadcast\s+version|uncensored|censored)(?:$|[\s）)】\]])/i;
const episodePatterns = [
  /\bS(?<season>\d{1,2})E(?<episode>\d{1,4}(?:\.\d)?)\b/i,
  /(?:第|\s|\[| - )(?<episode>\d{1,4}(?:\.\d)?)(?:话|集|\]|\s|v\d|$)/i,
  /\bEP?\s?(?<episode>\d{1,4}(?:\.\d)?)\b/i,
];
const releaseSeasonBannerPattern =
  /(?:^|[\s\[])(?:★\s*)?(?:\d{1,2}|[一二三四五六七八九十]+)\s*月\s*新番(?:\s*★)?(?:\]|$|\s*)/gi;
const seasonTitlePatterns = [
  /第\s*(?<season>[一二三四五六七八九十\d]+)\s*(?:季|期|シリーズ)/i,
  /\bS(?<season>\d{1,2})\b(?!\s*E\d)/i,
  /\b(?<season>\d{1,2})(?:st|nd|rd|th)\s+Season\b/i,
  /\bSeason\s*(?<season>\d{1,2})\b/i,
];
const toSimplifiedChinese = OpenCC.Converter({ from: "tw", to: "cn" });

export function normalizeTitle(title: string) {
  const parts = normalizeTitleAliases(title);
  const preferredPart = parts.find((part) => /[\u3400-\u9fff]/.test(part)) ?? parts[0];

  return preferredPart ?? normalizeTitlePart(title);
}

export function normalizeTitleAliases(title: string) {
  const aliases = canonicalizeTitle(title)
    .split(/\s+\/\s+|｜|\|/)
    .flatMap((part) => {
      const normalized = normalizeTitlePart(part);
      if (!normalized) {
        return [];
      }
      const values = [normalized];
      if (/^[a-z0-9\s]+$/i.test(normalized) && normalized.includes(" ")) {
        values.push(normalized.replace(/\s+/g, ""));
      }
      return values;
    })
    .filter(Boolean);

  return [...new Set(aliases)];
}

function normalizeTitlePart(title: string) {
  return stripSeasonWords(toSimplified(title))
    .toLowerCase()
    .replace(/\[[^\]]+\]|【[^】]+】/g, " ")
    .replace(/\(([^)]+)\)|（([^）]+)）/g, (_match, asciiContent, fullWidthContent) =>
      isNonTitleBracketContent(asciiContent || fullWidthContent) ? " " : ` ${asciiContent || fullWidthContent} `,
    )
    .replace(releaseEditionPattern, " ")
    .replace(/\[\s*\]/g, " ")
    .replace(/\b(2160p|4k|1080p|720p|480p|x265|x264|h265|h264|hevc|avc|av1|aac|flac|chs|cht)\b/g, " ")
    .replace(releaseSeasonBannerPattern, " ")
    .replace(/第\s*\d+(\.\d+)?\s*(话|集)/g, " ")
    .replace(/\bs\d{1,2}e\d{1,4}(\.\d+)?\b/g, " ")
    .replace(/\bep?\s?\d{1,4}(\.\d+)?\b/g, " ")
    .replace(/[._\-!！?？:：,，。·・、]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalizeTitle(title: string) {
  const normalized = title.replace(/\s+/g, " ").trim();
  const parts = normalized
    .split(/\s+\/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length <= 1) {
    return normalized;
  }

  const uniqueParts: string[] = [];
  for (const part of parts) {
    const key = normalizeComparableTitle(part);
    if (!uniqueParts.some((current) => normalizeComparableTitle(current) === key)) {
      uniqueParts.push(part);
    }
  }

  return uniqueParts.join(" / ");
}

export function parseAnimeReleaseTitle(rawTitle: string): ParsedAnimeRelease {
  const releaseTitle = stripReleaseFileExtension(rawTitle);
  const searchableTitle = releaseTitle.replace(/[_.-]+/g, " ");
  const releaseTags = [...releaseTitle.matchAll(/\[([^\]]+)\]|【([^】]+)】/g)]
    .map((match) => match[1] || match[2])
    .filter(Boolean);
  const subtitleGroup = releaseTags[0];
  const resolution = normalizeResolution(searchableTitle.match(resolutionPattern)?.[1]);
  const codec = searchableTitle.match(codecPattern)?.[1]?.toUpperCase().replace(".", "");
  const audio = searchableTitle.match(audioPattern)?.[1]?.toUpperCase();
  const subtitleLanguage = normalizeSubtitleLanguage(releaseTitle.match(subtitlePattern)?.[1]);
  const sourceKind = normalizeSourceKind(releaseTitle.match(sourcePattern)?.[1]);
  const bracketTitleTags = extractBracketTitleTags(releaseTitle);
  const releaseProfile = deriveReleaseProfile({
    audio,
    codec,
    rawTitle: releaseTitle,
    releaseTags,
    resolution,
    sourceKind,
    subtitleLanguage,
    subtitleGroup,
    titleTags: bracketTitleTags,
  });

  let episodeNumber: number | undefined;
  let season: number | undefined;
  for (const pattern of episodePatterns) {
    const match = releaseTitle.match(pattern);
    if (match?.groups?.episode) {
      episodeNumber = Number(match.groups.episode);
      season = match.groups.season ? Number(match.groups.season) : undefined;
      break;
    }
  }

  const leadingTitle = extractLeadingTitle(releaseTitle);
  const bracketTitle = bracketTitleTags.length > 0 ? canonicalizeTitle(bracketTitleTags.join(" / ")) : undefined;
  let parsedTitle = leadingTitle ?? bracketTitle ?? releaseTitle;
  const detectedSeason = detectSeason(parsedTitle) ?? detectSeason(releaseTitle);
  season = season ?? detectedSeason;

  if (!leadingTitle && !bracketTitle) {
    parsedTitle = parsedTitle
      .replace(/^\s*(\[[^\]]+\]|【[^】]+】)\s*/, "")
      .replace(releaseSeasonBannerPattern, " ")
      .replace(resolutionPattern, "")
      .replace(codecPattern, "")
      .replace(audioPattern, "");
  }

  for (const pattern of episodePatterns) {
    parsedTitle = parsedTitle.replace(pattern, " ");
  }

  parsedTitle = canonicalizeTitle(parsedTitle
    .replace(releaseSeasonBannerPattern, " ")
    .replace(/\[[^\]]+\]|【[^】]+】/g, " ")
    .replace(/\(([^)]+)\)|（([^）]+)）/g, (_match, asciiContent, fullWidthContent) =>
      isNonTitleBracketContent(asciiContent || fullWidthContent) ? " " : ` ${asciiContent || fullWidthContent} `,
    )
    .replace(releaseEditionPattern, " ")
    .replace(/\[\s*\]/g, " ")
    .replace(/[._]+/g, " ")
    .replace(/\s*\/\s*$/, "")
    .replace(/\s+-\s+$/, "")
    .replace(/\s+/g, " ")
    .trim());

  const normalizedTitle = normalizeTitle(parsedTitle || rawTitle);
  const signals = [
    normalizedTitle.length > 0,
    episodeNumber !== undefined,
    Boolean(resolution),
    Boolean(subtitleGroup),
  ].filter(Boolean).length;

  return {
    rawTitle,
    parsedTitle: parsedTitle || rawTitle,
    normalizedTitle: normalizedTitle || normalizeTitle(rawTitle) || rawTitle.toLowerCase(),
    subtitleGroup,
    episodeNumber,
    season,
    resolution,
    codec,
    audio,
    subtitleLanguage,
    releaseProfile,
    sourceKind,
    variantKey: buildVariantKey({
      subtitleGroup,
      resolution,
      codec,
      audio,
      subtitleLanguage,
      releaseProfile,
      sourceKind,
    }),
    releaseTags,
    confidence: Math.min(0.95, 0.35 + signals * 0.15),
  };
}

function stripReleaseFileExtension(value: string) {
  return value.replace(videoExtensionPattern, "");
}

function extractBracketTitleTags(rawTitle: string) {
  const matches = [...rawTitle.matchAll(/\[([^\]]+)\]|【([^】]+)】/g)];
  const titleTags: string[] = [];

  for (const [index, match] of matches.entries()) {
    const tag = (match[1] || match[2] || "").trim();
    if (!tag) {
      continue;
    }
    if (index === 0 && match.index === 0) {
      continue;
    }
    if (isReleaseSeasonBanner(tag)) {
      continue;
    }
    if (isEpisodeTag(tag) || isPureTechnicalTag(normalizeProfileAtom(tag)) || isSubtitleTag(tag)) {
      break;
    }
    titleTags.push(normalizeBracketTitleTag(tag));
  }

  return titleTags;
}

function extractLeadingTitle(rawTitle: string) {
  const withoutGroup = rawTitle.replace(/^\s*(\[[^\]]+\]|【[^】]+】)\s*/, "");
  const cleaned = withoutGroup
    .replace(releaseSeasonBannerPattern, " ")
    .replace(/^\s+/, "");
  const match =
    cleaned.match(/^(?<title>.+?)\s+-\s*(?<episode>\d{1,4}(?:\.\d+)?)(?:\s|\[|\(|v\d|$)/) ??
    cleaned.match(/^(?<title>.+?)\s+第(?<episode>\d{1,4}(?:\.\d+)?)话(?:\s|\[|\(|$)/);
  const title = match?.groups?.title?.trim();

  if (!title || isReleaseSeasonBanner(title) || isPureTechnicalTag(normalizeProfileAtom(title))) {
    return undefined;
  }

  return canonicalizeTitle(normalizeBracketTitleTag(title));
}

function normalizeBracketTitleTag(value: string) {
  return value
    .replace(/(?<=[\u3400-\u9fff])_(?=[A-Za-z0-9])/g, " / ")
    .replace(/(?<=[A-Za-z0-9])_(?=[\u3400-\u9fff])/g, " / ")
    .replace(/\s*_\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectSeason(value: string) {
  for (const pattern of seasonTitlePatterns) {
    const match = value.match(pattern);
    const rawSeason = match?.groups?.season;
    if (rawSeason) {
      return parseSeasonNumber(rawSeason);
    }
  }
  return undefined;
}

function stripSeasonWords(value: string) {
  return seasonTitlePatterns.reduce(
    (current, pattern) => current.replace(pattern, " "),
    value,
  );
}

function parseSeasonNumber(value: string) {
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

  return numerals[value] ?? undefined;
}

function isEpisodeTag(value: string) {
  return /^\d{1,4}(?:\.\d+)?(?:v\d+)?$/i.test(value.trim());
}

function isSubtitleTag(value: string) {
  return subtitlePattern.test(value) || /^(gb|big5|简中|繁中|简日双语|繁日双语)$/i.test(value.trim());
}

function isReleaseSeasonBanner(value: string) {
  return /^(?:★\s*)?(?:\d{1,2}|[一二三四五六七八九十]+)\s*月\s*新番(?:\s*★)?$/i.test(
    value.trim(),
  );
}

function normalizeSubtitleLanguage(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const normalized = value.toLowerCase();
  if (/(简繁日内封|简繁内嵌|简繁外挂|简繁)/i.test(value)) {
    return normalized.includes("日") ? "CHS+CHT+JPN" : "CHS+CHT";
  }
  if (/(简日内嵌)/i.test(value)) {
    return "CHS+JPN";
  }
  if (/(繁日内嵌)/i.test(value)) {
    return "CHT+JPN";
  }
  if (/(简体|chs|sc|gb)/i.test(value)) {
    return "CHS";
  }
  if (/(繁体|cht|tc|big5)/i.test(value)) {
    return "CHT";
  }
  return value.toUpperCase();
}

function normalizeResolution(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  if (/^4k$/i.test(value)) {
    return "2160p";
  }
  const dimensionMatch = value.match(/x(2160|1080|720|480)$/i);
  if (dimensionMatch?.[1]) {
    return `${dimensionMatch[1]}p`;
  }
  return value;
}

function normalizeSourceKind(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const normalized = value.toLowerCase().replace("-", "");
  if (normalized === "bluray") {
    return "BD";
  }
  if (normalized === "webdl") {
    return "WEB-DL";
  }
  if (normalized === "webrip") {
    return "WEBRip";
  }
  if (normalized === "baha") {
    return "Baha";
  }
  if (normalized === "cr") {
    return "CR";
  }
  if (normalized === "crunchyroll") {
    return "Crunchyroll";
  }
  if (normalized === "abema") {
    return "ABEMA";
  }
  if (normalized === "bglobal") {
    return "B-Global";
  }
  if (normalized === "netflix") {
    return "Netflix";
  }
  if (normalized === "amazon") {
    return "Amazon";
  }
  if (normalized === "bilibili") {
    return "Bilibili";
  }
  if (normalized === "tv") {
    return "TV";
  }
  return value;
}

function deriveReleaseProfile(input: {
  rawTitle: string;
  releaseTags: string[];
  subtitleGroup?: string;
  resolution?: string;
  codec?: string;
  audio?: string;
  subtitleLanguage?: string;
  sourceKind?: string;
  titleTags?: string[];
}) {
  const normalizedAtoms = new Set<string>();
  const skip = new Set(
    [
      input.subtitleGroup,
      input.resolution,
      input.codec,
      input.audio,
      input.sourceKind,
      input.subtitleLanguage,
    ]
      .filter(Boolean)
      .map((value) => normalizeProfileAtom(value as string)),
  );

  for (const tag of input.releaseTags) {
    const atom = normalizeProfileAtom(tag);
    const titleTag = input.titleTags?.some(
      (title) => normalizeProfileAtom(title) === atom || normalizeProfileAtom(normalizeBracketTitleTag(tag)) === normalizeProfileAtom(title),
    );
    if (!atom || skip.has(atom) || titleTag || isPureTechnicalTag(atom) || isReleaseSeasonBanner(tag)) {
      continue;
    }
    normalizedAtoms.add(tag.trim());
  }

  const subtitleMatch = input.rawTitle.match(subtitlePattern)?.[1];
  if (subtitleMatch) {
    normalizedAtoms.add(subtitleMatch);
  }
  if (input.sourceKind) {
    normalizedAtoms.add(input.sourceKind);
  }

  const profile = [...normalizedAtoms].join(" / ");
  return profile || undefined;
}

function isPureTechnicalTag(atom: string) {
  if (/^\d{1,4}(\.\d+)?$/.test(atom)) {
    return true;
  }
  const technicalTokens = atom.split(/\s+/).filter(Boolean);
  return technicalTokens.length > 0 && technicalTokens.every((token) =>
    /^(2160p|4k|1080p|720p|480p|\d{3,4}x(?:2160|1080|720|480)|x265|x264|h265|h264|hevc|avc|av1|aac|flac|opus|mp3|truehd|dts|mp4|mkv|10bit|8bit|web|dl|webrip|baha|cr|crunchyroll|abema|b|global|bilibili|gb|big5|简中|繁中)$/.test(
      token,
    ),
  );
}

function buildVariantKey(input: {
  subtitleGroup?: string;
  resolution?: string;
  codec?: string;
  audio?: string;
  subtitleLanguage?: string;
  releaseProfile?: string;
  sourceKind?: string;
}) {
  return [
    input.subtitleGroup,
    input.releaseProfile,
    input.subtitleLanguage,
    input.sourceKind,
    input.resolution,
    input.codec,
    input.audio,
  ]
    .map((value) => normalizeProfileAtom(value ?? ""))
    .filter(Boolean)
    .join("|") || undefined;
}

function normalizeProfileAtom(value: string) {
  return value
    .toLowerCase()
    .replace(/\[[^\]]+\]|\([^)]+\)|【[^】]+】/g, " ")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeComparableTitle(value: string) {
  return normalizeTitlePart(value)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function toSimplified(value: string) {
  return toSimplifiedChinese(value);
}

function isNonTitleBracketContent(value: string) {
  const normalized = normalizeProfileAtom(value);
  return (
    /^(?:19\d{2}|20\d{2})$/.test(normalized) ||
    isReleaseEdition(value) ||
    isPureTechnicalTag(normalized) ||
    isReleaseSeasonBanner(value)
  );
}

function isReleaseEdition(value: string) {
  return releaseEditionPattern.test(value);
}
