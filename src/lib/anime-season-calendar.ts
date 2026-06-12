import fs from "node:fs/promises";
import path from "node:path";
import type { MediaTitle } from "@prisma/client";
import { normalizeTitleAliases } from "@/lib/anime-parser";
import { prisma } from "@/lib/db";
import { getAppSettings, type AppSettings } from "@/lib/settings";

export const animeCalendarProviders = ["bangumi", "jikan"] as const;
export type AnimeCalendarProvider = (typeof animeCalendarProviders)[number];

export const animeCalendarQuarters = ["Q1", "Q2", "Q3", "Q4"] as const;
export type AnimeCalendarQuarter = (typeof animeCalendarQuarters)[number];

export type AnimeCalendarStatus =
  | "UNMATCHED"
  | "IN_LIBRARY"
  | "PLAYABLE"
  | "SUBSCRIBED"
  | "DOWNLOADING"
  | "MISSING";

export type AnimeCalendarItem = {
  provider: AnimeCalendarProvider;
  externalId: string;
  sourceUrl: string;
  title: string;
  titleNative: string | null;
  titleZhHans: string | null;
  titleEnglish: string | null;
  posterUrl: string | null;
  score: number | null;
  rank: number | null;
  popularity: number | null;
  airDate: string | null;
  weekday: number;
  broadcastTime: string | null;
  timezone: string | null;
  totalEpisodes: number | null;
  year: number | null;
  quarter: AnimeCalendarQuarter | null;
  local: AnimeCalendarLocalStatus | null;
};

export type AnimeCalendarLocalStatus = {
  mediaId: string;
  displayTitle: string;
  posterUrl: string | null;
  year: number | null;
  seasonCount: number;
  archivedEpisodes: number;
  playableEpisodes: number;
  wantedMissing: number;
  activeDownloads: number;
  waitingDownloads: number;
  subscribed: boolean;
  nextEpisodeId: string | null;
  status: AnimeCalendarStatus;
};

type FetchCalendarInput = {
  provider: AnimeCalendarProvider;
  year: number;
  quarter: AnimeCalendarQuarter;
};

type AnimeSeasonCalendarSettings = Pick<AppSettings, "directories" | "general">;

type GetAnimeSeasonCalendarOptions = {
  forceRefresh?: boolean;
  now?: Date;
  settings?: AnimeSeasonCalendarSettings;
};

type CachedProviderCalendar = {
  items: AnimeCalendarItem[];
  fetchedAt: Date;
  expiresAt: Date;
  hit: boolean;
  stale: boolean;
};

type AnimeCalendarCacheFile = {
  provider: AnimeCalendarProvider;
  year: number;
  quarter: AnimeCalendarQuarter;
  fetchedAt: string;
  items: AnimeCalendarItem[];
};

export type AnimeSeasonCalendarResult = {
  items: AnimeCalendarItem[];
  cache: {
    hit: boolean;
    stale: boolean;
    fetchedAt: string;
    expiresAt: string;
    refreshFrequencyMinutes: number;
  };
};

type BangumiCalendarDay = {
  weekday?: { id?: unknown };
  items?: unknown[];
};

type BangumiSubject = {
  id?: unknown;
  url?: unknown;
  name?: unknown;
  name_cn?: unknown;
  air_date?: unknown;
  air_weekday?: unknown;
  rating?: { score?: unknown };
  rank?: unknown;
  images?: { common?: unknown; medium?: unknown; large?: unknown; grid?: unknown };
  collection?: { doing?: unknown };
};

type JikanSeasonResponse = {
  pagination?: {
    has_next_page?: unknown;
    last_visible_page?: unknown;
  };
  data?: JikanAnime[];
};

type JikanAnime = {
  mal_id?: unknown;
  url?: unknown;
  title?: unknown;
  title_english?: unknown;
  title_japanese?: unknown;
  titles?: Array<{ type?: unknown; title?: unknown }>;
  images?: {
    webp?: { image_url?: unknown; large_image_url?: unknown };
    jpg?: { image_url?: unknown; large_image_url?: unknown };
  };
  episodes?: unknown;
  score?: unknown;
  rank?: unknown;
  members?: unknown;
  aired?: { from?: unknown };
  broadcast?: { day?: unknown; time?: unknown; timezone?: unknown };
  season?: unknown;
  year?: unknown;
};

type LocalMediaRecord = MediaTitle & {
  aliases: Array<{ title: string }>;
  metadata: Array<{ provider: string; externalId: string }>;
  seasons: Array<{
    number: number;
    episodes: Array<{
      id: string;
      number: number;
      files: Array<{ id: string }>;
      progress: Array<{ completed: boolean }>;
    }>;
  }>;
  wantedEpisodes: Array<{ status: string; ignored: boolean }>;
};

type SubscriptionRecord = {
  title: string;
  enabled: boolean;
  candidateGroup: {
    displayTitle: string;
    normalizedTitle: string;
    aliases: unknown;
  } | null;
};

type DownloadRecord = {
  status: string;
  candidate: {
    parsedTitle: string;
    normalizedTitle: string;
    group: {
      displayTitle: string;
      normalizedTitle: string;
      aliases: unknown;
    } | null;
  } | null;
};

const jikanSeasonByQuarter: Record<AnimeCalendarQuarter, string> = {
  Q1: "winter",
  Q2: "spring",
  Q3: "summer",
  Q4: "fall",
};

const weekdayByEnglishName = new Map([
  ["mondays", 1],
  ["tuesdays", 2],
  ["wednesdays", 3],
  ["thursdays", 4],
  ["fridays", 5],
  ["saturdays", 6],
  ["sundays", 7],
]);

export function getCurrentAnimeCalendarQuarter(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  return {
    year,
    quarter: quarterFromMonth(month),
  };
}

export function quarterFromMonth(month: number): AnimeCalendarQuarter {
  if (month <= 3) {
    return "Q1";
  }
  if (month <= 6) {
    return "Q2";
  }
  if (month <= 9) {
    return "Q3";
  }
  return "Q4";
}

export async function getAnimeSeasonCalendar(
  input: FetchCalendarInput,
  options: GetAnimeSeasonCalendarOptions = {},
): Promise<AnimeSeasonCalendarResult> {
  const settings = options.settings ?? await getAppSettings();
  const [externalResult, localContextResult] = await Promise.allSettled([
    getCachedProviderCalendar(input, settings, options),
    buildLocalAnimeCalendarContext(),
  ]);
  if (externalResult.status === "rejected") {
    throw externalResult.reason;
  }
  const localContext =
    localContextResult.status === "fulfilled"
      ? localContextResult.value
      : emptyLocalAnimeCalendarContext();

  const items = externalResult.value.items
    .map((item) => annotateCalendarItem(item, localContext))
    .sort(compareCalendarItems);

  return {
    items,
    cache: {
      hit: externalResult.value.hit,
      stale: externalResult.value.stale,
      fetchedAt: externalResult.value.fetchedAt.toISOString(),
      expiresAt: externalResult.value.expiresAt.toISOString(),
      refreshFrequencyMinutes: settings.general.animeCalendarRefreshMinutes,
    },
  };
}

async function fetchProviderCalendar(input: FetchCalendarInput): Promise<AnimeCalendarItem[]> {
  if (input.provider === "jikan") {
    return fetchJikanSeason(input.year, input.quarter);
  }
  return fetchBangumiCalendar(input.year, input.quarter);
}

async function getCachedProviderCalendar(
  input: FetchCalendarInput,
  settings: AnimeSeasonCalendarSettings,
  options: GetAnimeSeasonCalendarOptions,
): Promise<CachedProviderCalendar> {
  const now = options.now ?? new Date();
  const cachePath = animeCalendarCachePath(settings.directories.metadataDir, input);
  const cached = await readAnimeCalendarCache(cachePath, input, settings.general.animeCalendarRefreshMinutes);

  if (cached && !options.forceRefresh && cached.expiresAt > now) {
    return {
      ...cached,
      hit: true,
      stale: false,
    };
  }

  try {
    const items = stripLocalStatus(await fetchProviderCalendar(input));
    const fetchedAt = now;
    const expiresAt = animeCalendarCacheExpiresAt(fetchedAt, settings.general.animeCalendarRefreshMinutes);
    await writeAnimeCalendarCache(cachePath, {
      ...input,
      fetchedAt: fetchedAt.toISOString(),
      items,
    }).catch(() => null);
    return {
      items,
      fetchedAt,
      expiresAt,
      hit: false,
      stale: false,
    };
  } catch (error) {
    if (cached) {
      return {
        ...cached,
        hit: true,
        stale: true,
      };
    }
    throw error;
  }
}

function animeCalendarCachePath(metadataDir: string, input: FetchCalendarInput) {
  return path.join(
    metadataDir,
    "anime-season-calendar",
    `${input.provider}-${input.year}-${input.quarter}.json`,
  );
}

async function readAnimeCalendarCache(
  cachePath: string,
  input: FetchCalendarInput,
  refreshFrequencyMinutes: number,
): Promise<CachedProviderCalendar | null> {
  const raw = await fs.readFile(cachePath, "utf8").catch(() => null);
  if (!raw) {
    return null;
  }

  const parsed = safeJsonParse(raw);
  if (!isRecord(parsed)) {
    return null;
  }

  const fetchedAt = dateValue(parsed.fetchedAt);
  if (
    parsed.provider !== input.provider ||
    parsed.year !== input.year ||
    parsed.quarter !== input.quarter ||
    !fetchedAt ||
    !Array.isArray(parsed.items)
  ) {
    return null;
  }

  return {
    items: stripLocalStatus(parsed.items.filter(isAnimeCalendarItem)),
    fetchedAt,
    expiresAt: animeCalendarCacheExpiresAt(fetchedAt, refreshFrequencyMinutes),
    hit: true,
    stale: false,
  };
}

async function writeAnimeCalendarCache(cachePath: string, cache: AnimeCalendarCacheFile) {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

function animeCalendarCacheExpiresAt(fetchedAt: Date, refreshFrequencyMinutes: number) {
  return new Date(fetchedAt.getTime() + refreshFrequencyMinutes * 60_000);
}

function stripLocalStatus(items: AnimeCalendarItem[]) {
  return items.map((item) => ({
    ...item,
    local: null,
  }));
}

async function fetchBangumiCalendar(year: number, quarter: AnimeCalendarQuarter): Promise<AnimeCalendarItem[]> {
  const response = await fetch("https://api.bgm.tv/calendar", {
    headers: {
      Accept: "application/json",
      "User-Agent": "Kura/0.1 anime-season-calendar",
    },
    next: { revalidate: 60 * 60 },
  });
  if (!response.ok) {
    throw new Error(`Bangumi calendar request failed with HTTP ${response.status}.`);
  }

  const days = (await response.json()) as BangumiCalendarDay[];
  return days.flatMap((day) => {
    const weekday = positiveInteger(day.weekday?.id);
    if (!weekday || !Array.isArray(day.items)) {
      return [];
    }
    return day.items
      .map((rawItem) => normalizeBangumiItem(rawItem, weekday))
      .filter((item): item is AnimeCalendarItem => Boolean(item))
      .filter((item) => item.year === year && item.quarter === quarter);
  });
}

function normalizeBangumiItem(rawItem: unknown, weekday: number): AnimeCalendarItem | null {
  if (!isRecord(rawItem)) {
    return null;
  }
  const item = rawItem as BangumiSubject;
  const id = stringValue(item.id);
  const titleNative = stringValue(item.name);
  const titleZhHans = stringValue(item.name_cn);
  const airDate = dateString(item.air_date);
  const month = airDate ? Number(airDate.slice(5, 7)) : null;
  const year = airDate ? Number(airDate.slice(0, 4)) : null;
  if (!id || (!titleNative && !titleZhHans)) {
    return null;
  }
  return {
    provider: "bangumi" as const,
    externalId: id,
    sourceUrl: stringValue(item.url) ?? `https://bgm.tv/subject/${id}`,
    title: titleZhHans || titleNative || id,
    titleNative,
    titleZhHans,
    titleEnglish: null,
    posterUrl: stringValue(item.images?.common) ?? stringValue(item.images?.medium) ?? stringValue(item.images?.large) ?? stringValue(item.images?.grid),
    score: numberValue(item.rating?.score),
    rank: positiveInteger(item.rank),
    popularity: positiveInteger(item.collection?.doing),
    airDate,
    weekday,
    broadcastTime: null,
    timezone: null,
    totalEpisodes: null,
    year,
    quarter: month ? quarterFromMonth(month) : null,
    local: null,
  } satisfies AnimeCalendarItem;
}

async function fetchJikanSeason(year: number, quarter: AnimeCalendarQuarter): Promise<AnimeCalendarItem[]> {
  const season = jikanSeasonByQuarter[quarter];
  const items: AnimeCalendarItem[] = [];
  let hasNextPage = true;
  let page = 1;

  while (hasNextPage && page <= 8) {
    const response = await fetch(`https://api.jikan.moe/v4/seasons/${year}/${season}?sfw=true&page=${page}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Kura/0.1 anime-season-calendar",
      },
      next: { revalidate: 60 * 60 * 6 },
    });
    if (!response.ok) {
      throw new Error(`Jikan season request failed with HTTP ${response.status}.`);
    }

    const body = (await response.json()) as JikanSeasonResponse;
    items.push(...(body.data ?? []).map((item) => normalizeJikanItem(item, year, quarter)).filter((item): item is AnimeCalendarItem => Boolean(item)));
    hasNextPage = Boolean(body.pagination?.has_next_page);
    page += 1;
    if (hasNextPage) {
      await delay(360);
    }
  }

  return items;
}

function normalizeJikanItem(
  item: JikanAnime,
  year: number,
  quarter: AnimeCalendarQuarter,
): AnimeCalendarItem | null {
  const id = stringValue(item.mal_id);
  const defaultTitle = stringValue(item.title);
  const titleEnglish = stringValue(item.title_english) ?? titleByType(item, "English");
  const titleNative = stringValue(item.title_japanese) ?? titleByType(item, "Japanese");
  const airDate = dateString(item.aired?.from);
  const weekday = weekdayFromBroadcastDay(stringValue(item.broadcast?.day)) ?? weekdayFromDate(airDate) ?? 1;
  if (!id || !defaultTitle) {
    return null;
  }

  return {
    provider: "jikan" as const,
    externalId: id,
    sourceUrl: stringValue(item.url) ?? `https://myanimelist.net/anime/${id}`,
    title: titleEnglish ?? defaultTitle,
    titleNative,
    titleZhHans: null,
    titleEnglish,
    posterUrl:
      stringValue(item.images?.webp?.large_image_url) ??
      stringValue(item.images?.webp?.image_url) ??
      stringValue(item.images?.jpg?.large_image_url) ??
      stringValue(item.images?.jpg?.image_url),
    score: numberValue(item.score),
    rank: positiveInteger(item.rank),
    popularity: positiveInteger(item.members),
    airDate,
    weekday,
    broadcastTime: stringValue(item.broadcast?.time),
    timezone: stringValue(item.broadcast?.timezone),
    totalEpisodes: positiveInteger(item.episodes),
    year: positiveInteger(item.year) ?? year,
    quarter,
    local: null,
  } satisfies AnimeCalendarItem;
}

async function buildLocalAnimeCalendarContext() {
  const [media, subscriptions, downloads] = await Promise.all([
    prisma.mediaTitle.findMany({
      where: { type: "ANIME" },
      include: {
        aliases: true,
        metadata: true,
        seasons: {
          include: {
            episodes: {
              include: {
                files: { select: { id: true } },
                progress: { select: { completed: true } },
              },
            },
          },
        },
        wantedEpisodes: true,
      },
    }),
    prisma.subscription.findMany({
      where: { enabled: true, mediaType: "ANIME" },
      include: { candidateGroup: true },
    }),
    prisma.download.findMany({
      where: {
        status: { in: ["ACTIVE", "WAITING", "PAUSED"] },
        candidate: { mediaType: "ANIME" },
      },
      include: {
        candidate: {
          include: { group: true },
        },
      },
    }),
  ]);

  return {
    media: media.map((item) => buildMediaMatchEntry(item)),
    subscriptions: subscriptions.map((item) => buildSubscriptionMatchEntry(item)),
    downloads: downloads.map((item) => buildDownloadMatchEntry(item)),
  };
}

function emptyLocalAnimeCalendarContext(): Awaited<ReturnType<typeof buildLocalAnimeCalendarContext>> {
  return {
    media: [],
    subscriptions: [],
    downloads: [],
  };
}

function annotateCalendarItem(
  item: AnimeCalendarItem,
  context: Awaited<ReturnType<typeof buildLocalAnimeCalendarContext>>,
) {
  const itemKeys = buildExternalItemKeys(item);
  const matchedMedia = bestMediaMatch(item, itemKeys, context.media);
  const subscriptionMatches = context.subscriptions.filter((entry) => hasKeyOverlap(itemKeys, entry.keys));
  const downloadMatches = context.downloads.filter((entry) => hasKeyOverlap(itemKeys, entry.keys));

  if (!matchedMedia) {
    const subscribed = subscriptionMatches.length > 0;
    const activeDownloads = downloadMatches.filter((entry) => entry.status === "ACTIVE").length;
    const waitingDownloads = downloadMatches.filter((entry) => entry.status === "WAITING" || entry.status === "PAUSED").length;
    return {
      ...item,
      local: subscribed || activeDownloads || waitingDownloads
        ? {
            mediaId: "",
            displayTitle: item.title,
            posterUrl: item.posterUrl,
            year: item.year,
            seasonCount: 0,
            archivedEpisodes: 0,
            playableEpisodes: 0,
            wantedMissing: 0,
            activeDownloads,
            waitingDownloads,
            subscribed,
            nextEpisodeId: null,
            status: activeDownloads || waitingDownloads ? "DOWNLOADING" : "SUBSCRIBED",
          }
        : null,
    } satisfies AnimeCalendarItem;
  }

  const activeDownloads = downloadMatches.filter((entry) => entry.status === "ACTIVE").length;
  const waitingDownloads = downloadMatches.filter((entry) => entry.status === "WAITING" || entry.status === "PAUSED").length;
  const subscribed = subscriptionMatches.length > 0;
  const missingFromCatalog =
    item.totalEpisodes && item.totalEpisodes > matchedMedia.playableEpisodes
      ? item.totalEpisodes - matchedMedia.playableEpisodes
      : 0;
  const wantedMissing = Math.max(matchedMedia.wantedMissing, missingFromCatalog);
  const status = deriveLocalStatus({
    activeDownloads,
    playableEpisodes: matchedMedia.playableEpisodes,
    subscribed,
    waitingDownloads,
    wantedMissing,
  });

  return {
    ...item,
    local: {
      mediaId: matchedMedia.media.id,
      displayTitle: matchedMedia.media.primaryTitle,
      posterUrl: matchedMedia.media.posterUrl,
      year: matchedMedia.media.year,
      seasonCount: matchedMedia.seasonCount,
      archivedEpisodes: matchedMedia.archivedEpisodes,
      playableEpisodes: matchedMedia.playableEpisodes,
      wantedMissing,
      activeDownloads,
      waitingDownloads,
      subscribed,
      nextEpisodeId: matchedMedia.nextEpisodeId,
      status,
    },
  } satisfies AnimeCalendarItem;
}

function deriveLocalStatus(input: {
  activeDownloads: number;
  waitingDownloads: number;
  playableEpisodes: number;
  wantedMissing: number;
  subscribed: boolean;
}): AnimeCalendarStatus {
  if (input.activeDownloads > 0 || input.waitingDownloads > 0) {
    return "DOWNLOADING";
  }
  if (input.wantedMissing > 0) {
    return "MISSING";
  }
  if (input.playableEpisodes > 0) {
    return "PLAYABLE";
  }
  if (input.subscribed) {
    return "SUBSCRIBED";
  }
  return "IN_LIBRARY";
}

function buildMediaMatchEntry(media: LocalMediaRecord) {
  const episodes = media.seasons.flatMap((season) => season.episodes);
  const playableEpisodes = episodes.filter((episode) => episode.files.length > 0);
  const nextEpisode = playableEpisodes.find((episode) => !episode.progress[0]?.completed) ?? playableEpisodes[0] ?? null;
  return {
    media,
    keys: normalizedKeys([
      media.primaryTitle,
      media.originalTitle,
      ...media.aliases.map((alias) => alias.title),
    ]),
    providerIds: new Set(media.metadata.map((link) => `${normalizeProviderId(link.provider)}:${link.externalId}`)),
    seasonCount: media.seasons.length,
    archivedEpisodes: episodes.length,
    playableEpisodes: playableEpisodes.length,
    wantedMissing: media.wantedEpisodes.filter((episode) => !episode.ignored && episode.status === "MISSING").length,
    nextEpisodeId: nextEpisode?.id ?? null,
  };
}

function buildSubscriptionMatchEntry(subscription: SubscriptionRecord) {
  return {
    keys: normalizedKeys([
      subscription.title,
      subscription.candidateGroup?.displayTitle,
      subscription.candidateGroup?.normalizedTitle,
      ...jsonStringList(subscription.candidateGroup?.aliases),
    ]),
  };
}

function buildDownloadMatchEntry(download: DownloadRecord) {
  return {
    status: download.status,
    keys: normalizedKeys([
      download.candidate?.parsedTitle,
      download.candidate?.normalizedTitle,
      download.candidate?.group?.displayTitle,
      download.candidate?.group?.normalizedTitle,
      ...jsonStringList(download.candidate?.group?.aliases),
    ]),
  };
}

function bestMediaMatch(
  item: AnimeCalendarItem,
  itemKeys: Set<string>,
  entries: ReturnType<typeof buildMediaMatchEntry>[],
) {
  const providerKey = `${normalizeProviderId(item.provider)}:${item.externalId}`;
  return entries
    .map((entry) => {
      if (entry.providerIds.has(providerKey)) {
        return { entry, score: 1000 };
      }
      return { entry, score: overlapCount(itemKeys, entry.keys) };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.playableEpisodes - a.entry.playableEpisodes)[0]
    ?.entry ?? null;
}

function buildExternalItemKeys(item: AnimeCalendarItem) {
  return normalizedKeys([item.title, item.titleZhHans, item.titleNative, item.titleEnglish]);
}

function normalizedKeys(values: Array<string | null | undefined>) {
  const keys = new Set<string>();
  for (const value of values) {
    for (const alias of normalizeTitleAliases(value ?? "")) {
      keys.add(alias);
    }
  }
  return keys;
}

function hasKeyOverlap(a: Set<string>, b: Set<string>) {
  return overlapCount(a, b) > 0;
}

function overlapCount(a: Set<string>, b: Set<string>) {
  let count = 0;
  for (const key of a) {
    if (b.has(key)) {
      count += 1;
    }
  }
  return count;
}

function compareCalendarItems(a: AnimeCalendarItem, b: AnimeCalendarItem) {
  return (
    a.weekday - b.weekday ||
    compareNullableStrings(a.broadcastTime, b.broadcastTime) ||
    compareNullableStrings(a.airDate, b.airDate) ||
    a.title.localeCompare(b.title, "zh-Hans")
  );
}

function compareNullableStrings(a: string | null, b: string | null) {
  if (a && b) {
    return a.localeCompare(b);
  }
  if (a) {
    return -1;
  }
  if (b) {
    return 1;
  }
  return 0;
}

function titleByType(item: JikanAnime, type: string) {
  return item.titles?.find((title) => stringValue(title.type) === type)?.title
    ? stringValue(item.titles.find((title) => stringValue(title.type) === type)?.title)
    : null;
}

function weekdayFromBroadcastDay(day: string | null) {
  return day ? weekdayByEnglishName.get(day.toLowerCase()) ?? null : null;
}

function weekdayFromDate(value: string | null) {
  if (!value) {
    return null;
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const utcDay = date.getUTCDay();
  return utcDay === 0 ? 7 : utcDay;
}

function dateString(value: unknown) {
  const text = stringValue(value);
  if (!text) {
    return null;
  }
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}

function stringValue(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function numberValue(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function positiveInteger(value: unknown) {
  const number = typeof value === "number" ? Math.floor(value) : Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function dateValue(value: unknown) {
  const text = stringValue(value);
  if (!text) {
    return null;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function jsonStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function normalizeProviderId(provider: string) {
  if (provider === "bangumi") {
    return "bgm";
  }
  if (provider === "jikan") {
    return "mal";
  }
  if (provider === "myanimelist") {
    return "mal";
  }
  return provider.toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAnimeCalendarItem(value: unknown): value is AnimeCalendarItem {
  if (!isRecord(value)) {
    return false;
  }
  return (
    animeCalendarProviders.includes(value.provider as AnimeCalendarProvider) &&
    typeof value.externalId === "string" &&
    typeof value.sourceUrl === "string" &&
    typeof value.title === "string" &&
    positiveInteger(value.weekday) !== null
  );
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
