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

const resolutionPattern = /\b(2160p|4k|1080p|720p|480p)\b/i;
const codecPattern = /\b(x265|x264|h\.?265|h\.?264|hevc|avc|av1)\b/i;
const audioPattern = /\b(aac|flac|opus|mp3|truehd|dts)\b/i;
const subtitlePattern = /(简繁日内封|简日内嵌|繁日内嵌|简繁内嵌|简繁外挂|简体|繁体|简繁|chs|cht|sc|tc|gb|big5)/i;
const sourcePattern = /\b(web-?dl|webrip|baha|crunchyroll|b-global|netflix|amazon|bilibili|tv|bd|blu-?ray)\b/i;
const episodePatterns = [
  /\bS(?<season>\d{1,2})E(?<episode>\d{1,4}(?:\.\d)?)\b/i,
  /(?:第|\s|\[| - )(?<episode>\d{1,4}(?:\.\d)?)(?:话|集|\]|\s|v\d|$)/i,
  /\bEP?\s?(?<episode>\d{1,4}(?:\.\d)?)\b/i,
];

export function normalizeTitle(title: string) {
  return canonicalizeTitle(title)
    .toLowerCase()
    .replace(/\[[^\]]+\]|\([^)]+\)|【[^】]+】/g, " ")
    .replace(/\[\s*\]/g, " ")
    .replace(/\b(2160p|4k|1080p|720p|480p|x265|x264|h265|h264|hevc|avc|av1|aac|flac|chs|cht)\b/g, " ")
    .replace(/第\s*\d+(\.\d+)?\s*(话|集)/g, " ")
    .replace(/\bs\d{1,2}e\d{1,4}(\.\d+)?\b/g, " ")
    .replace(/\bep?\s?\d{1,4}(\.\d+)?\b/g, " ")
    .replace(/[._-]+/g, " ")
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
  const searchableTitle = rawTitle.replace(/[_.-]+/g, " ");
  const releaseTags = [...rawTitle.matchAll(/\[([^\]]+)\]|【([^】]+)】/g)]
    .map((match) => match[1] || match[2])
    .filter(Boolean);
  const subtitleGroup = releaseTags[0];
  const resolution = searchableTitle.match(resolutionPattern)?.[1]?.replace(/^4k$/i, "2160p");
  const codec = searchableTitle.match(codecPattern)?.[1]?.toUpperCase().replace(".", "");
  const audio = searchableTitle.match(audioPattern)?.[1]?.toUpperCase();
  const subtitleLanguage = normalizeSubtitleLanguage(rawTitle.match(subtitlePattern)?.[1]);
  const sourceKind = normalizeSourceKind(rawTitle.match(sourcePattern)?.[1]);
  const releaseProfile = deriveReleaseProfile({
    audio,
    codec,
    rawTitle,
    releaseTags,
    resolution,
    sourceKind,
    subtitleLanguage,
    subtitleGroup,
  });

  let episodeNumber: number | undefined;
  let season: number | undefined;
  for (const pattern of episodePatterns) {
    const match = rawTitle.match(pattern);
    if (match?.groups?.episode) {
      episodeNumber = Number(match.groups.episode);
      season = match.groups.season ? Number(match.groups.season) : undefined;
      break;
    }
  }

  let parsedTitle = rawTitle
    .replace(/^\s*(\[[^\]]+\]|【[^】]+】)\s*/, "")
    .replace(resolutionPattern, "")
    .replace(codecPattern, "")
    .replace(audioPattern, "");

  for (const pattern of episodePatterns) {
    parsedTitle = parsedTitle.replace(pattern, " ");
  }

  parsedTitle = canonicalizeTitle(parsedTitle
    .replace(/\[[^\]]+\]|\([^)]+\)|【[^】]+】/g, " ")
    .replace(/\[\s*\]/g, " ")
    .replace(/[._]+/g, " ")
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
  if (normalized === "crunchyroll") {
    return "Crunchyroll";
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
    if (!atom || skip.has(atom) || isPureTechnicalTag(atom)) {
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
    /^(2160p|4k|1080p|720p|480p|x265|x264|h265|h264|hevc|avc|av1|aac|flac|opus|mp3|truehd|dts|mp4|mkv|10bit|8bit)$/.test(
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
  return value
    .toLowerCase()
    .replace(/\[[^\]]+\]|\([^)]+\)|【[^】]+】/g, " ")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
