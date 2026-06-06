import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import * as OpenCC from "opencc-js";
import { Prisma, type MediaTitle, type TitleAlias, type WantedEpisode } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeTitleAliases } from "@/lib/anime-parser";
import { normalizeParsedReleaseEpisode } from "@/lib/episode-normalizer";
import { parseMediaReleaseTitle } from "@/lib/media-parser";
import { enqueueCandidateDownload } from "@/lib/downloads";
import { attachTorrentAvailability, type TorrentAvailability } from "@/lib/torrent-availability";

type WantedWithMedia = WantedEpisode & {
  mediaTitle: MediaTitle & {
    aliases: TitleAlias[];
  };
};

type FeedItem = {
  title: unknown;
  link?: unknown;
  guid?: unknown;
  pubDate?: string;
  isoDate?: string;
  enclosure?: unknown;
  "nyaa:seeders"?: unknown;
  "nyaa:size"?: unknown;
};

export type WantedSearchResult = {
  key: string;
  provider: string;
  sourceId: string | null;
  sourceName: string;
  title: string;
  link: string | null;
  magnetUrl: string | null;
  torrentUrl: string | null;
  publishedAt: string | null;
  seeders: number | null;
  size: string | null;
  availability?: TorrentAvailability;
  match: "strong" | "related";
  reason: string;
  parsed: {
    title: string;
    episodeNumber: number | null;
    season: number | null;
    resolution: string | null;
    subtitleGroup: string | null;
    codec: string | null;
  };
};

export type WantedSearchSourceError = {
  sourceName: string;
  query: string;
  message: string;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

const builtinSearchSources = [
  {
    provider: "dmhy",
    sourceName: "DMHY",
    url: "https://share.dmhy.org/topics/rss/rss.xml?keyword={query}",
  },
];
const wantedReleaseEditionPattern =
  /(?:^|[\s（(【\[])(?:放送版|オンエア版|先行放送版|先行版|無修正版|修正版|on[\s-]?air\s+version|broadcast\s+version|uncensored|censored)(?:$|[\s）)】\]])/gi;
const wantedVideoExtensionPattern = /\.(mkv|mp4|avi|mov|webm|m4v|ts)$/i;
const wantedSeasonTitlePattern =
  /(?:第\s*[一二三四五六七八九十\d]+\s*(?:季|期|シリーズ|クール)|\bS\d{1,2}\b(?!\s*E\d)|\b\d{1,2}(?:st|nd|rd|th)\s+Season\b|\bSeason\s*\d{1,2}\b)/gi;
const toSimplifiedChinese = OpenCC.Converter({ from: "tw", to: "cn" });
const toTraditionalChinese = OpenCC.Converter({ from: "cn", to: "tw" });

export async function searchWantedEpisodeSources(
  wantedEpisodeId: string,
  options: { probeAvailability?: boolean } = {},
) {
  const wanted = await loadWanted(wantedEpisodeId);
  const queries = buildWantedEpisodeSearchQueries(wanted);
  const mediaAliasSet = mediaAliases(wanted.mediaTitle);
  const results: WantedSearchResult[] = [];
  const seen = new Set<string>();
  const sourceErrors: WantedSearchSourceError[] = [];

  results.push(...(await searchCachedConfiguredSources(wanted, mediaAliasSet, seen)));

  const configuredSources = await prisma.rssSource.findMany({
    where: {
      enabled: true,
      mediaType: wanted.mediaTitle.type,
      OR: [{ url: { contains: "{query}" } }, { url: { contains: "{{query}}" } }],
    },
    orderBy: { createdAt: "asc" },
  });
  const sources = [
    ...(wanted.mediaTitle.type === "ANIME"
      ? builtinSearchSources.map((source) => ({ ...source, sourceId: null }))
      : []),
    ...configuredSources.map((source) => ({
      provider: "rss-source",
      sourceId: source.id,
      sourceName: source.name,
      url: source.url,
    })),
  ];

  for (const source of sources) {
    for (const query of queries.slice(0, 12)) {
      const url = renderSearchUrl(source.url, query);
      try {
        const response = await fetch(url, {
          headers: { "User-Agent": "Kura/0.1 Wanted RSS Search" },
        });
        if (!response.ok) {
          sourceErrors.push({
            sourceName: source.sourceName,
            query,
            message: `HTTP ${response.status}`,
          });
          continue;
        }
        const xml = await response.text();
        const feedResults = parseWantedSearchFeed(xml, {
          provider: source.provider,
          sourceId: source.sourceId,
          sourceName: source.sourceName,
        });
        for (const result of feedResults) {
          addScoredResult(results, seen, result, wanted, mediaAliasSet);
        }
      } catch {
        sourceErrors.push({
          sourceName: source.sourceName,
          query,
          message: "Network request failed",
        });
        continue;
      }
    }
  }

  return {
    wantedEpisodeId,
    queries,
    results: options.probeAvailability === false
      ? sortSearchResults(results).slice(0, 30)
      : await attachTorrentAvailability(sortSearchResults(results).slice(0, 30), {
          probeLimit: 5,
          shouldProbe: (result) => result.match === "strong",
        }),
    sourceErrors: sourceErrors.slice(0, 12),
  };
}

export async function selectWantedSearchResultForDownload(
  wantedEpisodeId: string,
  input: WantedSearchResult,
) {
  const wanted = await loadWanted(wantedEpisodeId);
  const parsed = parseMediaReleaseTitle(input.title, wanted.mediaTitle.type);
  const targetEpisode = wanted.episodeNumber;
  const normalizedEpisode = normalizeParsedReleaseEpisode({
    rawTitle: input.title,
    parsedTitle: parsed.parsedTitle,
    season: parsed.season ?? wanted.seasonNumber,
    episodeNumber: parsed.episodeNumber,
  });
  const parsedEpisode = normalizedEpisode.episodeNumber;
  if (parsedEpisode !== targetEpisode) {
    throw new Error("Selected release does not match the wanted episode.");
  }

  const sourceId = input.sourceId
    ? (await prisma.rssSource.findUnique({ where: { id: input.sourceId }, select: { id: true } }))?.id ?? null
    : null;
  const guid = stableGuid(`${input.provider}:${input.link ?? input.magnetUrl ?? input.torrentUrl ?? input.title}`);
  const existing = await prisma.rssItem.findFirst({
    where: {
      OR: [
        { guid },
        ...(input.link ? [{ link: input.link }] : []),
        ...(input.magnetUrl ? [{ magnetUrl: input.magnetUrl }] : []),
        ...(input.torrentUrl ? [{ torrentUrl: input.torrentUrl }] : []),
      ],
    },
    include: { candidate: true },
  });
  const rssItem =
    existing ??
    (await prisma.rssItem.create({
      data: {
        source: sourceId ? { connect: { id: sourceId } } : undefined,
        origin: "wanted-search",
        mediaType: wanted.mediaTitle.type,
        guid,
        title: input.title,
        link: input.link,
        magnetUrl: input.magnetUrl,
        torrentUrl: input.torrentUrl,
        publishedAt: input.publishedAt ? new Date(input.publishedAt) : undefined,
        raw: input as Prisma.InputJsonValue,
      },
      include: { candidate: true },
    }));

  const group = await upsertWantedCandidateGroup(wanted, parsed);
  const candidate =
    rssItem.candidate ??
    (await prisma.releaseCandidate.create({
      data: {
        rssItem: { connect: { id: rssItem.id } },
        group: { connect: { id: group.id } },
        mediaType: wanted.mediaTitle.type,
        rawTitle: input.title,
        parsedTitle: parsed.parsedTitle,
        normalizedTitle: parsed.normalizedTitle,
        subtitleGroup: parsed.subtitleGroup,
        episodeNumber: normalizedEpisode.episodeNumber,
        season: normalizedEpisode.season,
        resolution: parsed.resolution,
        codec: parsed.codec,
        audio: parsed.audio,
        subtitleLanguage: parsed.subtitleLanguage,
        releaseProfile: parsed.releaseProfile,
        sourceKind: parsed.sourceKind,
        variantKey: parsed.variantKey,
        releaseTags: parsed.releaseTags,
        magnetUrl: input.magnetUrl,
        torrentUrl: input.torrentUrl,
        sourceUrl: input.link,
        confidence: Math.max(parsed.confidence, input.match === "strong" ? 0.86 : 0.7),
        status: input.match === "strong" ? "READY" : "REVIEW",
      },
    }));

  if (candidate.groupId !== group.id) {
    await prisma.releaseCandidate.update({
      where: { id: candidate.id },
      data: { groupId: group.id },
    });
  }

  await prisma.wantedEpisode.update({
    where: { id: wanted.id },
    data: {
      matchedCandidateId: candidate.id,
      status: "CANDIDATE_FOUND",
      reason: "Selected from wanted episode RSS search",
      ignored: false,
    },
  });
  const download = await enqueueCandidateDownload(candidate.id);
  await prisma.wantedEpisode.update({
    where: { id: wanted.id },
    data: {
      status: "DOWNLOADING",
      reason: "Download queued from wanted episode search",
    },
  });

  return { candidate, download };
}

export function parseWantedSearchFeed(
  xml: string,
  source: { provider: string; sourceId: string | null; sourceName: string },
): WantedSearchResult[] {
  const parsed = parser.parse(xml);
  const items = normalizeFeedItems(parsed);
  const results: WantedSearchResult[] = [];
  for (const item of items) {
    const title = normalizeText(item.title);
    if (!title) {
      continue;
    }
    const magnetUrl = extractMagnet(item) ?? null;
    const torrentUrl = extractTorrentUrl(item) ?? null;
    const link = extractPrimaryLink(item) ?? magnetUrl ?? torrentUrl ?? null;
    const publishedAt = parseDate(item.isoDate || item.pubDate);
    results.push({
      key: stableGuid(`${source.provider}:${link ?? title}`),
      provider: source.provider,
      sourceId: source.sourceId,
      sourceName: source.sourceName,
      title,
      link,
      magnetUrl,
      torrentUrl,
      publishedAt: publishedAt?.toISOString() ?? null,
      seeders: parseOptionalNumber(item["nyaa:seeders"]),
      size: normalizeText(item["nyaa:size"]) ?? null,
      match: "related",
      reason: "Parsed from RSS search",
      parsed: {
        title,
        episodeNumber: null,
        season: null,
        resolution: null,
        subtitleGroup: null,
        codec: null,
      },
    });
  }
  return results;
}

export function buildWantedEpisodeSearchQueries(wanted: WantedWithMedia) {
  const episode = wanted.episodeNumber;
  const paddedEpisode = String(episode).padStart(2, "0");
  const baseTitles = [
    wanted.mediaTitle.primaryTitle,
    wanted.mediaTitle.originalTitle,
    ...wanted.mediaTitle.aliases.map((alias) => alias.title),
  ]
    .flatMap((title) => wantedSearchBaseTitleCandidates(title))
    .filter(uniqueByNormalized);
  const titles = [
    ...baseTitles,
    ...baseTitles.flatMap(wantedSearchChineseVariants),
  ].filter(uniqueBySearchText);
  const queries: string[] = [];

  for (const title of titles.slice(0, 8)) {
    if (wanted.seasonNumber > 1) {
      queries.push(`${title} S${String(wanted.seasonNumber).padStart(2, "0")}E${paddedEpisode}`);
    }
    queries.push(`${title} ${paddedEpisode}`);
    if (paddedEpisode !== String(episode)) {
      queries.push(`${title} ${episode}`);
    }
  }

  return queries.filter(uniqueString).slice(0, 16);
}

async function searchCachedConfiguredSources(
  wanted: WantedWithMedia,
  mediaAliasSet: Set<string>,
  seen: Set<string>,
) {
  const baseAliases = [
    wanted.mediaTitle.primaryTitle,
    wanted.mediaTitle.originalTitle,
    ...wanted.mediaTitle.aliases.map((alias) => alias.title),
  ]
    .flatMap(wantedSearchBaseTitleCandidates)
    .filter(uniqueByNormalized);
  const aliases = [
    ...baseAliases,
    ...baseAliases.flatMap(wantedSearchChineseVariants),
  ].filter(uniqueBySearchText);
  if (aliases.length === 0) {
    return [];
  }
  const items = await prisma.rssItem.findMany({
    where: {
      mediaType: wanted.mediaTitle.type,
      sourceId: { not: null },
      OR: aliases.slice(0, 16).map((title) => ({
        title: { contains: title, mode: "insensitive" },
      })),
    },
    include: { source: { select: { id: true, name: true } } },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: 80,
  });
  const results: WantedSearchResult[] = [];
  for (const item of items) {
    addScoredResult(
      results,
      seen,
      {
        key: stableGuid(`cached:${item.id}`),
        provider: "configured-cache",
        sourceId: item.source?.id ?? null,
        sourceName: item.source?.name ?? "Configured RSS",
        title: item.title,
        link: item.link,
        magnetUrl: item.magnetUrl,
        torrentUrl: item.torrentUrl,
        publishedAt: item.publishedAt?.toISOString() ?? null,
        seeders: null,
        size: null,
        match: "related",
        reason: "Existing configured RSS item",
        parsed: {
          title: item.title,
          episodeNumber: null,
          season: null,
          resolution: null,
          subtitleGroup: null,
          codec: null,
        },
      },
      wanted,
      mediaAliasSet,
    );
  }
  return results;
}

function addScoredResult(
  results: WantedSearchResult[],
  seen: Set<string>,
  result: WantedSearchResult,
  wanted: WantedWithMedia,
  mediaAliasSet: Set<string>,
) {
  const dedupeKey = stableGuid(result.link ?? result.magnetUrl ?? result.torrentUrl ?? result.title);
  if (seen.has(dedupeKey)) {
    return;
  }
  const parsed = parseMediaReleaseTitle(result.title, wanted.mediaTitle.type);
  const normalizedEpisode = normalizeParsedReleaseEpisode({
    rawTitle: result.title,
    parsedTitle: parsed.parsedTitle,
    season: parsed.season ?? wanted.seasonNumber,
    episodeNumber: parsed.episodeNumber,
  });
  const parsedEpisode = normalizedEpisode.episodeNumber;
  const parsedSeason = normalizedEpisode.season;
  const titleMatches = normalizeTitleAliases(parsed.parsedTitle)
    .concat(normalizeTitleAliases(parsed.normalizedTitle))
    .some((alias) => mediaAliasSet.has(alias));
  const episodeMatches = parsedEpisode === wanted.episodeNumber;
  const seasonMatches = parsedSeason === wanted.seasonNumber;
  if (!titleMatches && !episodeMatches) {
    return;
  }

  seen.add(dedupeKey);
  results.push({
    ...result,
    key: dedupeKey,
    match: titleMatches && episodeMatches && seasonMatches ? "strong" : "related",
    reason:
      titleMatches && episodeMatches && seasonMatches
        ? "Title and episode matched"
        : "Title or episode partially matched",
    parsed: {
      title: parsed.parsedTitle,
      episodeNumber: normalizedEpisode.episodeNumber,
      season: normalizedEpisode.season,
      resolution: parsed.resolution ?? null,
      subtitleGroup: parsed.subtitleGroup ?? null,
      codec: parsed.codec ?? null,
    },
  });
}

function sortSearchResults(results: WantedSearchResult[]) {
  return [...results].sort((a, b) => {
    const matchScore = scoreMatch(b) - scoreMatch(a);
    if (matchScore !== 0) {
      return matchScore;
    }
    return Date.parse(b.publishedAt ?? "") - Date.parse(a.publishedAt ?? "");
  });
}

function scoreMatch(result: WantedSearchResult) {
  const seederScore = result.seeders === null ? 0 : Math.min(result.seeders, 200) / 100;
  return (result.match === "strong" ? 10 : 1) + seederScore;
}

async function upsertWantedCandidateGroup(wanted: WantedWithMedia, parsed: ReturnType<typeof parseMediaReleaseTitle>) {
  const aliases = [
    wanted.mediaTitle.primaryTitle,
    wanted.mediaTitle.originalTitle,
    ...wanted.mediaTitle.aliases.map((alias) => alias.title),
    parsed.parsedTitle,
  ].filter((title): title is string => Boolean(title?.trim()));
  const normalizedTitle = normalizeTitleAliases(wanted.mediaTitle.primaryTitle)[0] ?? parsed.normalizedTitle;
  return prisma.releaseCandidateGroup.upsert({
    where: {
      mediaType_normalizedTitle_season: {
        mediaType: wanted.mediaTitle.type,
        normalizedTitle,
        season: wanted.seasonNumber,
      },
    },
    create: {
      mediaType: wanted.mediaTitle.type,
      normalizedTitle,
      displayTitle: wanted.mediaTitle.primaryTitle,
      season: wanted.seasonNumber,
      confidence: Math.max(parsed.confidence, 0.86),
      reviewRequired: false,
      aiSummary: "Created from wanted episode search selection.",
      aliases: aliases.filter(uniqueString) as Prisma.InputJsonValue,
    },
    update: {
      displayTitle: wanted.mediaTitle.primaryTitle,
      aliases: aliases.filter(uniqueString) as Prisma.InputJsonValue,
    },
  });
}

async function loadWanted(wantedEpisodeId: string) {
  return prisma.wantedEpisode.findUniqueOrThrow({
    where: { id: wantedEpisodeId },
    include: {
      mediaTitle: {
        include: { aliases: true },
      },
    },
  });
}

function mediaAliases(media: WantedWithMedia["mediaTitle"]) {
  return new Set(
    [
      media.primaryTitle,
      media.originalTitle,
      ...media.aliases.map((alias) => alias.title),
    ]
      .flatMap((value) =>
        wantedSearchBaseTitleCandidates(value)
          .flatMap((title) => [title, ...wantedSearchChineseVariants(title)])
          .flatMap((title) => normalizeTitleAliases(title)),
      ),
  );
}

function wantedSearchBaseTitleCandidates(value: string | null | undefined) {
  const raw = value?.trim();
  if (!raw) {
    return [];
  }
  const base = cleanWantedSearchTitle(raw);
  const candidates: string[] = [];
  const parts = base
    .split(/\s+\/\s+|｜|\|/)
    .map((part) => cleanWantedSearchTitle(part))
    .filter(Boolean);
  for (const part of parts) {
    const seasonless = stripWantedSearchSeasonTitle(part);
    if (seasonless && seasonless !== part) {
      candidates.push(seasonless);
    }
    candidates.push(part);
  }
  if (parts.length <= 1) {
    candidates.push(base);
  }
  return candidates.filter((title) => title.length >= 2 && !looksLikeReleaseFileTitle(title));
}

function wantedSearchChineseVariants(value: string) {
  if (!/[\u3400-\u9fff]/.test(value)) {
    return [];
  }
  return [toSimplifiedChinese(value), toTraditionalChinese(value)]
    .map((title) => title.trim())
    .filter((title) => title && title !== value);
}

function cleanWantedSearchTitle(value: string) {
  return value
    .replace(wantedVideoExtensionPattern, "")
    .replace(/\[[^\]]*]|\([^)]*(?:1080p|2160p|720p|x26[45]|hevc|avc|aac|mkv|mp4|web-?dl|webrip|baha|abema|cr)[^)]*\)|【[^】]*】/gi, " ")
    .replace(/\s+-\s*S\d{1,2}E\d{1,4}(?:\.\d+)?\b.*$/i, " ")
    .replace(/\s+-\s*\d{1,4}(?:\.\d+)?\b.*$/i, " ")
    .replace(wantedReleaseEditionPattern, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripWantedSearchSeasonTitle(value: string) {
  return value.replace(wantedSeasonTitlePattern, " ").replace(/\s+/g, " ").trim();
}

function looksLikeReleaseFileTitle(value: string) {
  return (
    wantedVideoExtensionPattern.test(value) ||
    /\b(?:1080p|2160p|720p|x26[45]|hevc|avc|aac|mkv|mp4|web-?dl|webrip)\b/i.test(value)
  );
}

function renderSearchUrl(template: string, query: string) {
  const encoded = encodeURIComponent(query);
  return template.replaceAll("{{query}}", encoded).replaceAll("{query}", encoded);
}

function normalizeFeedItems(parsed: unknown): FeedItem[] {
  const value = parsed as {
    rss?: { channel?: { item?: FeedItem | FeedItem[] } };
    feed?: { entry?: FeedItem | FeedItem[] };
  };
  const items = value.rss?.channel?.item ?? value.feed?.entry ?? [];
  return Array.isArray(items) ? items : [items];
}

function normalizeText(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (value && typeof value === "object" && "#text" in value) {
    return String((value as { "#text": unknown })["#text"]).trim();
  }
  if (value && typeof value === "object" && "@_href" in value) {
    return String((value as { "@_href": unknown })["@_href"]).trim();
  }
  if (value && typeof value === "object" && "href" in value) {
    return String((value as { href: unknown }).href).trim();
  }
  if (value && typeof value === "object" && "@_url" in value) {
    return String((value as { "@_url": unknown })["@_url"]).trim();
  }
  if (value && typeof value === "object" && "url" in value) {
    return String((value as { url: unknown }).url).trim();
  }
  return undefined;
}

function extractMagnet(item: FeedItem) {
  return extractLinks(item).find((candidate) => candidate.startsWith("magnet:"));
}

function extractTorrentUrl(item: FeedItem) {
  return extractLinks(item).find((candidate) => isTorrentUrl(candidate));
}

function extractPrimaryLink(item: FeedItem) {
  return extractLinks(item).find((candidate) => !candidate.startsWith("magnet:"));
}

function extractLinks(item: FeedItem) {
  const candidates = [
    ...normalizeUnknownList(item.link),
    item.guid,
    ...normalizeUnknownList(item.enclosure),
  ];
  return candidates
    .map((candidate) => normalizeText(candidate))
    .filter((candidate): candidate is string => Boolean(candidate));
}

function normalizeUnknownList(value: unknown) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function isTorrentUrl(value: string) {
  try {
    const url = new URL(value);
    return url.pathname.toLowerCase().endsWith(".torrent") || url.search.toLowerCase().includes("torrent");
  } catch {
    return value.toLowerCase().includes(".torrent");
  }
}

function parseDate(value?: string) {
  if (!value) {
    return undefined;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp);
}

function parseOptionalNumber(value: unknown) {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function stableGuid(value: string) {
  return createHash("sha1").update(value).digest("hex");
}

function uniqueString(value: string, index: number, values: string[]) {
  return values.indexOf(value) === index;
}

function uniqueByNormalized(value: string, index: number, values: string[]) {
  const normalized = normalizeTitleAliases(value)[0] ?? value.toLowerCase();
  return values.findIndex((candidate) => (normalizeTitleAliases(candidate)[0] ?? candidate.toLowerCase()) === normalized) === index;
}

function uniqueBySearchText(value: string, index: number, values: string[]) {
  const normalized = value.toLowerCase().replace(/\s+/g, " ").trim();
  return values.findIndex((candidate) => candidate.toLowerCase().replace(/\s+/g, " ").trim() === normalized) === index;
}
