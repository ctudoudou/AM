import path from "node:path";
import { Prisma, type MediaType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeTitleAliases } from "@/lib/anime-parser";
import { parseMediaReleaseTitle } from "@/lib/media-parser";
import { cacheRemoteMediaAsset, isLocalMediaAssetUrl } from "@/lib/media-assets";
import {
  aliasesFromMetadataRaw,
  aliasesFromTitleTexts,
  upsertTitleAliases,
} from "@/lib/title-display";

export type MetadataMatch = {
  provider:
    | "anilist"
    | "tmdb"
    | "tmdb_movie"
    | "tmdb_tv"
    | "bangumi"
    | "jikan"
    | "kitsu"
    | "omdb"
    | "fallback";
  externalId: string;
  title: string;
  originalTitle?: string;
  year?: number;
  synopsis?: string;
  posterUrl?: string;
  backdropUrl?: string;
  language?: string;
  score: number;
  relevance?: number;
  raw: unknown;
};

type AniListMedia = {
  id: number | string;
  title?: {
    romaji?: string | null;
    english?: string | null;
    native?: string | null;
  } | null;
  startDate?: { year?: number | null } | null;
  description?: string | null;
  coverImage?: { extraLarge?: string | null; large?: string | null } | null;
  bannerImage?: string | null;
  averageScore?: number | null;
};

type AniListResponse = {
  data?: {
    Page?: {
      media?: AniListMedia[];
    };
  };
};

type TmdbTvResult = {
  id: number | string;
  name?: string | null;
  title?: string | null;
  original_name?: string | null;
  original_title?: string | null;
  first_air_date?: string | null;
  release_date?: string | null;
  overview?: string | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  original_language?: string | null;
  vote_average?: number | null;
};

type TmdbSearchResponse = {
  results?: TmdbTvResult[];
};

type BangumiSubject = {
  id: number | string;
  name?: string | null;
  name_cn?: string | null;
  date?: string | null;
  summary?: string | null;
  images?: { large?: string | null; common?: string | null } | null;
  score?: number | null;
};

type BangumiSearchResponse = {
  data?: BangumiSubject[];
};

type JikanAnime = {
  mal_id: number | string;
  title?: string | null;
  title_english?: string | null;
  title_japanese?: string | null;
  year?: number | null;
  synopsis?: string | null;
  images?: {
    jpg?: { large_image_url?: string | null; image_url?: string | null };
    webp?: { large_image_url?: string | null; image_url?: string | null };
  } | null;
  score?: number | null;
};

type JikanSearchResponse = {
  data?: JikanAnime[];
};

type KitsuAnime = {
  id: string;
  attributes?: {
    canonicalTitle?: string | null;
    titles?: Record<string, string | null> | null;
    startDate?: string | null;
    synopsis?: string | null;
    posterImage?: { large?: string | null; original?: string | null } | null;
    coverImage?: { large?: string | null; original?: string | null } | null;
    averageRating?: string | null;
  } | null;
};

type KitsuSearchResponse = {
  data?: KitsuAnime[];
};

const releaseEditionPattern =
  /(?:^|[\s（(【\[])(?:放送版|オンエア版|先行放送版|先行版|無修正版|修正版|on[\s-]?air\s+version|broadcast\s+version|uncensored|censored)(?:$|[\s）)】\]])/gi;

type OmdbSearchItem = {
  imdbID: string;
  Title?: string;
  Year?: string;
  Type?: string;
  Poster?: string;
};

type OmdbSearchResponse = {
  Search?: OmdbSearchItem[];
  Response?: string;
};

const romanNumerals = new Map([
  ["一", 1],
  ["二", 2],
  ["三", 3],
  ["四", 4],
  ["五", 5],
  ["六", 6],
  ["七", 7],
  ["八", 8],
  ["九", 9],
  ["十", 10],
]);

function optionalString(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function optionalNumber(value: number | null | undefined) {
  return value ?? undefined;
}

export async function matchMetadataForGroup(groupId: string) {
  const group = await prisma.releaseCandidateGroup.findUniqueOrThrow({
    where: { id: groupId },
  });
  const query = group.displayTitle || group.normalizedTitle;
  const providerResults = await searchMediaMetadata(query, group.mediaType);

  const results =
    providerResults.length > 0
      ? providerResults
      : [
          {
            provider: "fallback" as const,
            externalId: group.id,
            title: group.displayTitle,
            score: 0.55,
            relevance: 1,
            raw: { reason: "No metadata provider returned a result" },
          },
        ];

  for (const result of results) {
    await prisma.metadataProviderResult.upsert({
      where: {
        provider_externalId_candidateGroupId: {
          provider: result.provider,
          externalId: result.externalId,
          candidateGroupId: group.id,
        },
      },
      create: {
        candidateGroupId: group.id,
        provider: result.provider,
        externalId: result.externalId,
        title: result.title,
        originalTitle: result.originalTitle,
        year: result.year,
        synopsis: result.synopsis,
        posterUrl: result.posterUrl,
        backdropUrl: result.backdropUrl,
        language: result.language,
        score: result.score,
        raw: result.raw as Prisma.InputJsonValue,
      },
      update: {
        title: result.title,
        originalTitle: result.originalTitle,
        year: result.year,
        synopsis: result.synopsis,
        posterUrl: result.posterUrl,
        backdropUrl: result.backdropUrl,
        language: result.language,
        score: result.score,
        raw: result.raw as Prisma.InputJsonValue,
      },
    });
  }

  return selectBestMetadataMatch(results, group.season ?? undefined);
}

export async function refreshAnimeLibraryMetadata(input?: { titleId?: string; onlyMissing?: boolean }) {
  return refreshMediaLibraryMetadata({ ...input, mediaType: "ANIME" });
}

export async function refreshMediaLibraryMetadata(input?: {
  titleId?: string;
  onlyMissing?: boolean;
  mediaType?: MediaType;
}) {
  const titles = await prisma.mediaTitle.findMany({
    where: {
      type: input?.mediaType,
      id: input?.titleId,
      ...(input?.onlyMissing === false
        ? {}
        : {
            OR: [{ posterUrl: null }, { backdropUrl: null }, { synopsis: null }],
          }),
    },
    select: {
      id: true,
    },
  });
  const results = [];

  for (const title of titles) {
    results.push(await refreshMediaMetadata(title.id));
  }

  return {
    checked: titles.length,
    updated: results.filter((result) => result.updated).length,
    results,
  };
}

export async function refreshMediaMetadata(titleId: string) {
  const media = await prisma.mediaTitle.findUniqueOrThrow({
    where: { id: titleId },
    include: {
      aliases: true,
      seasons: {
        include: {
          episodes: {
            include: {
              files: {
                select: {
                  originalName: true,
                  absolutePath: true,
                },
              },
            },
          },
        },
      },
    },
  });
  if (media.type === "ANIME") {
    return refreshAnimeMetadata(titleId);
  }

  const queryTexts = collectMediaMetadataQueryTexts(media);
  const queries = buildGenericMetadataQueries(queryTexts);
  const matches = [];
  for (const query of queries) {
    matches.push(...(await searchMediaMetadata(query, media.type)));
    const best = selectBestMetadataMatch(matches);
    if (best?.posterUrl && best.score >= 0.9 && (best.relevance ?? 0) >= 0.86) {
      break;
    }
  }

  const best = selectBestMetadataMatch(matches);
  if (!best) {
    return {
      id: media.id,
      title: media.primaryTitle,
      updated: false,
      queries,
      provider: null,
    };
  }

  await upsertTitleAliases(media.id, [
    ...aliasesFromTitleTexts([
      media.primaryTitle,
      media.originalTitle,
      best.title,
      best.originalTitle,
      ...media.aliases.map((alias) => alias.title),
    ]),
    ...aliasesFromMetadataRaw(best.raw),
  ]);
  const posterUrl =
    (await cacheRemoteMediaAsset(best.posterUrl, {
      mediaId: media.id,
      kind: "poster",
    })) ?? (isLocalMediaAssetUrl(media.posterUrl) ? media.posterUrl : undefined);
  const backdropUrl =
    (await cacheRemoteMediaAsset(best.backdropUrl, {
      mediaId: media.id,
      kind: "backdrop",
    })) ?? (isLocalMediaAssetUrl(media.backdropUrl) ? media.backdropUrl : undefined);

  const updated = await prisma.mediaTitle.update({
    where: { id: media.id },
    data: {
      primaryTitle: best.title,
      originalTitle: best.originalTitle,
      year: best.year,
      synopsis: best.synopsis,
      posterUrl,
      backdropUrl,
    },
    select: {
      id: true,
      primaryTitle: true,
      posterUrl: true,
      backdropUrl: true,
      synopsis: true,
    },
  });

  await prisma.metadataLink
    .upsert({
      where: {
        provider_externalId: {
          provider: best.provider,
          externalId: best.externalId,
        },
      },
      create: {
        provider: best.provider,
        externalId: best.externalId,
        mediaId: media.id,
      },
      update: {
        mediaId: media.id,
      },
    })
    .catch(() => null);

  return {
    id: updated.id,
    title: updated.primaryTitle,
    updated: Boolean(updated.posterUrl || updated.backdropUrl || updated.synopsis),
    queries,
    provider: best.provider,
    posterUrl: updated.posterUrl,
  };
}

export async function refreshAnimeMetadata(titleId: string) {
  const media = await prisma.mediaTitle.findUniqueOrThrow({
    where: { id: titleId },
    include: {
      aliases: true,
      seasons: {
        include: {
          episodes: {
            include: {
              files: {
                select: {
                  originalName: true,
                  absolutePath: true,
                },
              },
            },
          },
        },
      },
    },
  });
  const queryTexts = collectAnimeMetadataQueryTexts(media);
  const queries = buildAnimeMetadataQueries(queryTexts);
  const targetSeason = queries.map(detectSeason).find((season): season is number => Boolean(season));
  await upsertTitleAliases(
    media.id,
    aliasesFromTitleTexts(queryTexts),
  );
  const matches = [];

  for (const query of queries) {
    matches.push(...(await searchAnimeMetadata(query)));
    const best = selectBestMetadataMatch(matches, targetSeason);
    const seasonSatisfied = !targetSeason || Boolean(best && metadataResultHasSeason(best, targetSeason));
    if (seasonSatisfied && best?.posterUrl && best.score >= 0.92 && (best.relevance ?? 0) >= 0.9) {
      break;
    }
  }

  const best = selectBestMetadataMatch(matches, targetSeason);
  if (!best) {
    return {
      id: media.id,
      title: media.primaryTitle,
      updated: false,
      queries,
      provider: null,
    };
  }

  await upsertTitleAliases(media.id, [
    ...aliasesFromTitleTexts([
      media.primaryTitle,
      media.originalTitle,
      best.title,
      best.originalTitle,
    ]),
    ...aliasesFromMetadataRaw(best.raw),
  ]);
  const posterUrl =
    (await cacheRemoteMediaAsset(best.posterUrl, {
      mediaId: media.id,
      kind: "poster",
    })) ?? (isLocalMediaAssetUrl(media.posterUrl) ? media.posterUrl : undefined);
  const backdropUrl =
    (await cacheRemoteMediaAsset(best.backdropUrl, {
      mediaId: media.id,
      kind: "backdrop",
    })) ?? (isLocalMediaAssetUrl(media.backdropUrl) ? media.backdropUrl : undefined);

  const updated = await prisma.mediaTitle.update({
    where: { id: media.id },
    data: {
      primaryTitle: shouldReplaceReleaseEditionTitle(media.primaryTitle, best.title)
        ? best.title
        : undefined,
      originalTitle: targetSeason ? best.originalTitle : media.originalTitle ?? best.originalTitle,
      year: targetSeason ? best.year : media.year ?? best.year,
      synopsis: media.synopsis ?? best.synopsis,
      posterUrl,
      backdropUrl,
    },
    select: {
      id: true,
      primaryTitle: true,
      posterUrl: true,
      backdropUrl: true,
      synopsis: true,
    },
  });

  await prisma.metadataLink
    .upsert({
      where: {
        provider_externalId: {
          provider: best.provider,
          externalId: best.externalId,
        },
      },
      create: {
        provider: best.provider,
        externalId: best.externalId,
        mediaId: media.id,
      },
      update: {
        mediaId: media.id,
      },
    })
    .catch(() => null);
  await prisma.metadataLink
    .deleteMany({
      where: {
        mediaId: media.id,
        NOT: {
          provider: best.provider,
          externalId: best.externalId,
        },
      },
    })
    .catch(() => null);

  return {
    id: updated.id,
    title: updated.primaryTitle,
    updated: Boolean(updated.posterUrl || updated.backdropUrl || updated.synopsis),
    queries,
    provider: best.provider,
    posterUrl: updated.posterUrl,
  };
}

export function collectAnimeMetadataQueryTexts(media: {
  primaryTitle: string;
  originalTitle?: string | null;
  aliases?: Array<{ title: string }>;
  seasons?: Array<{
    episodes: Array<{
      title?: string | null;
      files?: Array<{
        originalName?: string | null;
        absolutePath?: string | null;
      }>;
    }>;
  }>;
}) {
  const values = [
    media.primaryTitle,
    media.originalTitle,
    ...(media.aliases ?? []).map((alias) => alias.title),
  ];
  for (const episode of (media.seasons ?? []).flatMap((season) => season.episodes)) {
    values.push(episode.title);
    for (const file of episode.files ?? []) {
      values.push(file.originalName);
      values.push(file.absolutePath ? path.basename(file.absolutePath, path.extname(file.absolutePath)) : null);
    }
  }
  return uniqueQueryTexts(values);
}

export function collectMediaMetadataQueryTexts(media: {
  primaryTitle: string;
  originalTitle?: string | null;
  aliases?: Array<{ title: string }>;
  seasons?: Array<{
    episodes: Array<{
      title?: string | null;
      files?: Array<{
        originalName?: string | null;
        absolutePath?: string | null;
      }>;
    }>;
  }>;
}) {
  const values = [
    media.primaryTitle,
    media.originalTitle,
    ...(media.aliases ?? []).map((alias) => alias.title),
  ];
  for (const episode of (media.seasons ?? []).flatMap((season) => season.episodes)) {
    for (const file of episode.files ?? []) {
      values.push(file.originalName);
      values.push(file.absolutePath ? path.basename(file.absolutePath, path.extname(file.absolutePath)) : null);
    }
  }
  return uniqueQueryTexts(values);
}

export function buildGenericMetadataQueries(values: Array<string | null | undefined>) {
  const queries: string[] = [];
  for (const value of values) {
    const title = cleanSearchTitle(value ?? "")
      .replace(/\bS\d{1,2}E\d{1,4}\b/gi, " ")
      .replace(/\b\d{1,2}x\d{1,4}\b/gi, " ")
      .replace(/\b(1080p|2160p|720p|web-?dl|webrip|bluray|bdrip|x26[45]|h\.?26[45]|hevc|avc)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!title) {
      continue;
    }
    addQuery(queries, title);
    addQuery(queries, title.replace(/\b(19\d{2}|20\d{2})\b/g, " ").replace(/\s+/g, " ").trim());
  }
  return queries.slice(0, 8);
}

export function buildAnimeMetadataQueries(values: Array<string | null | undefined>) {
  const queries: string[] = [];

  for (const value of prioritizeAnimeMetadataQueryValues(values)) {
    const title = cleanSearchTitle(value ?? "");
    if (!title) {
      continue;
    }
    addQuery(queries, title);

    for (const part of title.split(/\s+\/\s+|｜|\|/).map((item) => cleanSearchTitle(item))) {
      if (!part) {
        continue;
      }
      addQuery(queries, part);
      addQuery(queries, stripSeasonWords(part));
      const season = detectSeason(part);
      const stripped = stripSeasonWords(part);
      if (season && stripped) {
        addQuery(queries, `${stripped} ${ordinal(season)} Season`);
        addQuery(queries, `${stripped} Season ${season}`);
      }
    }
  }

  return queries.slice(0, 10);
}

function prioritizeAnimeMetadataQueryValues(values: Array<string | null | undefined>) {
  const seeds: Array<{ value: string; score: number; index: number }> = [];

  values.forEach((value, index) => {
    const text = value?.replace(/\s+/g, " ").trim();
    if (!text) {
      return;
    }
    const releaseLike = isReleaseLikeMetadataQuery(text);
    if (releaseLike) {
      const parsedTitle = parseMediaReleaseTitle(text, "ANIME").parsedTitle;
      if (parsedTitle && parsedTitle !== text) {
        seeds.push({
          value: parsedTitle,
          score: scoreMetadataQueryValue(parsedTitle, false) + 12,
          index,
        });
      }
    }
    seeds.push({
      value: text,
      score: scoreMetadataQueryValue(text, releaseLike),
      index,
    });
  });

  const seen = new Set<string>();
  return seeds
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((seed) => seed.value)
    .filter((value) => {
      const key = cleanSearchTitle(value).toLowerCase();
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

export async function searchAnimeMetadata(query: string): Promise<MetadataMatch[]> {
  return searchMediaMetadata(query, "ANIME");
}

export async function searchMediaMetadata(
  query: string,
  mediaType: MediaType = "ANIME",
): Promise<MetadataMatch[]> {
  const providerResults = (
    mediaType === "ANIME"
      ? await Promise.allSettled([
          searchAniList(query),
          searchBangumi(query),
          searchJikan(query),
          searchKitsu(query),
          searchTmdb(query, "tv"),
        ])
      : await Promise.allSettled([
          searchTmdb(query, mediaType === "MOVIE" ? "movie" : "tv"),
          searchOmdb(query, mediaType),
        ])
  ).flatMap((result) => (result.status === "fulfilled" ? result.value : []));

  return providerResults
    .map((result) => {
      const relevance = scoreMetadataRelevance(query, result);
      return {
        ...result,
        synopsis: result.synopsis ? cleanDescription(result.synopsis) : undefined,
        score: result.score * 0.65 + relevance * 0.35,
        relevance,
      };
    })
    .filter((result) => result.relevance >= 0.48)
    .map(stripRelevance)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(Boolean(b.posterUrl)) - Number(Boolean(a.posterUrl)),
    );
}

async function searchAniList(query: string): Promise<MetadataMatch[]> {
  const response = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(8_000),
    body: JSON.stringify({
      query: `
        query ($search: String) {
          Page(page: 1, perPage: 3) {
            media(search: $search, type: ANIME) {
              id
              title { romaji english native }
              startDate { year }
              description(asHtml: false)
              coverImage { extraLarge large }
              bannerImage
              averageScore
            }
          }
        }
      `,
      variables: { search: query },
    }),
  });
  if (!response.ok) {
    return [];
  }
  const body = (await response.json()) as AniListResponse;
  const media = body?.data?.Page?.media ?? [];
  return media.map((item) => ({
    provider: "anilist" as const,
    externalId: String(item.id),
    title: item.title?.english || item.title?.romaji || item.title?.native || query,
    originalTitle: optionalString(item.title?.native),
    year: optionalNumber(item.startDate?.year),
    synopsis: optionalString(item.description),
    posterUrl: optionalString(item.coverImage?.extraLarge || item.coverImage?.large),
    backdropUrl: optionalString(item.bannerImage),
    language: "multi",
    score: Math.min(0.96, 0.72 + (item.averageScore ?? 0) / 500),
    raw: item,
  }));
}

async function searchTmdb(query: string, kind: "movie" | "tv"): Promise<MetadataMatch[]> {
  const token = process.env.TMDB_API_KEY;
  if (!token) {
    return [];
  }
  const url = new URL(`https://api.themoviedb.org/3/search/${kind}`);
  url.searchParams.set("query", query);
  url.searchParams.set("include_adult", "false");
  url.searchParams.set("language", "zh-CN");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    return [];
  }
  const body = (await response.json()) as TmdbSearchResponse;
  return (body.results ?? []).slice(0, 3).map((item) => ({
    provider: kind === "movie" ? ("tmdb_movie" as const) : ("tmdb_tv" as const),
    externalId: String(item.id),
    title: item.title || item.name || item.original_title || item.original_name || query,
    originalTitle: optionalString(item.original_title || item.original_name),
    year: item.release_date
      ? Number(String(item.release_date).slice(0, 4))
      : item.first_air_date
        ? Number(String(item.first_air_date).slice(0, 4))
        : undefined,
    synopsis: optionalString(item.overview),
    posterUrl: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : undefined,
    backdropUrl: item.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` : undefined,
    language: optionalString(item.original_language),
    score: Math.min(0.95, 0.68 + (item.vote_average ?? 0) / 40),
    raw: item,
  }));
}

async function searchBangumi(query: string): Promise<MetadataMatch[]> {
  const response = await fetch("https://api.bgm.tv/v0/search/subjects", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Kura/0.1",
    },
    signal: AbortSignal.timeout(8_000),
    body: JSON.stringify({
      keyword: query,
      filter: { type: [2] },
    }),
  });
  if (!response.ok) {
    return [];
  }
  const body = (await response.json()) as BangumiSearchResponse;
  return (body.data ?? []).slice(0, 3).map((item) => ({
    provider: "bangumi" as const,
    externalId: String(item.id),
    title: item.name_cn || item.name || query,
    originalTitle: optionalString(item.name),
    year: item.date ? Number(String(item.date).slice(0, 4)) : undefined,
    synopsis: optionalString(item.summary),
    posterUrl: optionalString(item.images?.large || item.images?.common),
    language: "zh",
    score: Math.min(0.95, 0.7 + (item.score ?? 0) / 40),
    raw: item,
  }));
}

async function searchJikan(query: string): Promise<MetadataMatch[]> {
  const url = new URL("https://api.jikan.moe/v4/anime");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "3");
  url.searchParams.set("sfw", "true");
  const response = await fetch(url, {
    headers: { "User-Agent": "Kura/0.1" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    return [];
  }
  const body = (await response.json()) as JikanSearchResponse;
  return (body.data ?? []).slice(0, 3).map((item) => ({
    provider: "jikan" as const,
    externalId: String(item.mal_id),
    title: item.title_english || item.title || item.title_japanese || query,
    originalTitle: optionalString(item.title_japanese),
    year: optionalNumber(item.year),
    synopsis: optionalString(item.synopsis),
    posterUrl: optionalString(
      item.images?.webp?.large_image_url ||
        item.images?.jpg?.large_image_url ||
        item.images?.webp?.image_url ||
        item.images?.jpg?.image_url,
    ),
    language: "multi",
    score: Math.min(0.94, 0.66 + (item.score ?? 0) / 35),
    raw: item,
  }));
}

async function searchKitsu(query: string): Promise<MetadataMatch[]> {
  const url = new URL("https://kitsu.io/api/edge/anime");
  url.searchParams.set("filter[text]", query);
  url.searchParams.set("page[limit]", "3");
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.api+json",
      "User-Agent": "Kura/0.1",
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    return [];
  }
  const body = (await response.json()) as KitsuSearchResponse;
  return (body.data ?? []).slice(0, 3).map((item) => {
    const attrs = item.attributes;
    const titles = attrs?.titles ?? {};
    return {
      provider: "kitsu" as const,
      externalId: item.id,
      title:
        attrs?.canonicalTitle ||
        titles.en ||
        titles.en_jp ||
        titles.ja_jp ||
        query,
      originalTitle: optionalString(titles.ja_jp || titles.en_jp),
      year: attrs?.startDate ? Number(String(attrs.startDate).slice(0, 4)) : undefined,
      synopsis: optionalString(attrs?.synopsis),
      posterUrl: optionalString(attrs?.posterImage?.large || attrs?.posterImage?.original),
      backdropUrl: optionalString(attrs?.coverImage?.large || attrs?.coverImage?.original),
      language: "multi",
      score: Math.min(0.93, 0.64 + Number(attrs?.averageRating ?? 0) / 260),
      raw: item,
    };
  });
}

async function searchOmdb(query: string, mediaType: MediaType): Promise<MetadataMatch[]> {
  const apiKey = process.env.OMDB_API_KEY;
  if (!apiKey || mediaType === "ANIME") {
    return [];
  }
  const url = new URL("https://www.omdbapi.com/");
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("s", query);
  url.searchParams.set("type", mediaType === "MOVIE" ? "movie" : "series");
  const response = await fetch(url, {
    headers: { "User-Agent": "Kura/0.1" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    return [];
  }
  const body = (await response.json()) as OmdbSearchResponse;
  if (body.Response === "False") {
    return [];
  }
  return (body.Search ?? []).slice(0, 3).map((item) => ({
    provider: "omdb" as const,
    externalId: item.imdbID,
    title: item.Title || query,
    year: parseOmdbYear(item.Year),
    posterUrl: item.Poster && item.Poster !== "N/A" ? item.Poster : undefined,
    language: "multi",
    score: 0.72,
    raw: item,
  }));
}

function selectBestMetadataMatch(results: MetadataMatch[], targetSeason?: number) {
  return [...results].sort(
    (a, b) =>
      metadataSelectionScore(b, targetSeason) - metadataSelectionScore(a, targetSeason) ||
      Number(Boolean(b.posterUrl)) - Number(Boolean(a.posterUrl)) ||
      Number(Boolean(b.backdropUrl)) - Number(Boolean(a.backdropUrl)),
  )[0];
}

function metadataSelectionScore(result: MetadataMatch, targetSeason?: number) {
  if (!targetSeason) {
    return result.score;
  }
  return result.score + (metadataResultHasSeason(result, targetSeason) ? 0.22 : -0.22);
}

function stripRelevance<T extends MetadataMatch & { relevance: number }>(result: T): MetadataMatch {
  return {
    provider: result.provider,
    externalId: result.externalId,
    title: result.title,
    originalTitle: result.originalTitle,
    year: result.year,
    synopsis: result.synopsis,
    posterUrl: result.posterUrl,
    backdropUrl: result.backdropUrl,
    language: result.language,
    score: result.score,
    relevance: result.relevance,
    raw: result.raw,
  };
}

export function scoreMetadataRelevance(query: string, result: MetadataMatch) {
  const queryAliases = metadataAliasesFromText(query);
  const resultAliases = metadataAliasesFromMatch(result);
  const querySeason = detectSeason(query);

  let best = 0;
  for (const queryAlias of queryAliases) {
    for (const resultAlias of resultAliases) {
      if (queryAlias === resultAlias) {
        best = Math.max(best, 1);
        continue;
      }
      if (
        queryAlias.length >= 8 &&
        resultAlias.length >= 8 &&
        (queryAlias.includes(resultAlias) || resultAlias.includes(queryAlias))
      ) {
        best = Math.max(best, 0.86);
        continue;
      }
      best = Math.max(best, tokenSimilarity(queryAlias, resultAlias));
    }
  }

  if (isSideStoryOrCollaborationResult(query, result)) {
    best = Math.min(best, 0.42);
  }
  if (querySeason && !metadataResultHasSeason(result, querySeason)) {
    best = Math.min(best, 0.5);
  }

  return best;
}

function isSideStoryOrCollaborationResult(query: string, result: MetadataMatch) {
  if (/\b(?:ova|oad|ona|special|cm|commercial|movie)\b|剧场|劇場|联动|聯動|合作|合味道/i.test(query)) {
    return false;
  }
  const text = metadataPrimaryTexts(result).join(" ");
  if (/\b(?:special|ova|oad|ona|cm|commercial)\b|剧场|劇場|联动|聯動|合作|合味道|cup\s*noodles?|nissin/i.test(text)) {
    return true;
  }
  const raw = result.raw;
  if (!raw || typeof raw !== "object") {
    return false;
  }
  const record = raw as Record<string, unknown>;
  const type = String(record.type ?? record.platform ?? "").toLowerCase();
  if (/\b(?:special|ova|oad|ona|movie|music|cm|commercial)\b/.test(type)) {
    return true;
  }
  const tags = [
    ...rawArrayStrings(record.meta_tags),
    ...rawArrayStrings(record.genres),
    ...rawArrayStrings(record.demographics),
  ].join(" ");
  return /\b(?:special|ova|oad|ona|movie|music|cm|commercial)\b|剧场|劇場|联动|聯動|合作/.test(tags);
}

function metadataResultHasSeason(result: MetadataMatch, season: number) {
  return metadataPrimaryTexts(result).some((text) => detectSeason(text) === season);
}

function metadataPrimaryTexts(result: MetadataMatch) {
  const raw = result.raw && typeof result.raw === "object" ? (result.raw as Record<string, unknown>) : {};
  return [
    result.title,
    result.originalTitle,
    typeof raw.title === "string" ? raw.title : null,
    typeof raw.title_english === "string" ? raw.title_english : null,
    typeof raw.title_japanese === "string" ? raw.title_japanese : null,
    typeof raw.name === "string" ? raw.name : null,
    typeof raw.name_cn === "string" ? raw.name_cn : null,
    typeof raw.canonicalTitle === "string" ? raw.canonicalTitle : null,
  ].filter((value): value is string => Boolean(value));
}

function rawArrayStrings(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (typeof item === "string") {
      return [item];
    }
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      return [record.name, record.title].filter((text): text is string => typeof text === "string");
    }
    return [];
  });
}

function metadataAliasesFromMatch(result: MetadataMatch) {
  const values = [
    result.title,
    result.originalTitle,
    ...metadataAliasesFromRaw(result.raw),
  ];
  return uniqueAliases(values);
}

function metadataAliasesFromText(value: string | null | undefined) {
  return uniqueAliases([value]);
}

function uniqueAliases(values: Array<string | null | undefined>) {
  return [
    ...new Set(
      values
        .flatMap((value) => normalizeTitleAliases(value ?? ""))
        .map((value) => value.trim())
        .filter((value) => value.length >= 3),
    ),
  ];
}

function metadataAliasesFromRaw(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") {
    return [];
  }
  const record = raw as Record<string, unknown>;
  const values: string[] = [];
  for (const key of [
    "title",
    "title_english",
    "title_japanese",
    "name",
    "name_cn",
    "original_title",
    "original_name",
    "canonicalTitle",
  ]) {
    const value = record[key];
    if (typeof value === "string") {
      values.push(value);
    }
  }
  const title = record.title;
  if (title && typeof title === "object") {
    values.push(...Object.values(title).filter((value): value is string => typeof value === "string"));
  }
  const attrs = record.attributes;
  if (attrs && typeof attrs === "object") {
    values.push(...metadataAliasesFromRaw(attrs));
  }
  const titles = record.titles;
  if (Array.isArray(titles)) {
    for (const item of titles) {
      if (typeof item === "string") {
        values.push(item);
      } else if (item && typeof item === "object") {
        const value = (item as Record<string, unknown>).title;
        if (typeof value === "string") {
          values.push(value);
        }
      }
    }
  } else if (titles && typeof titles === "object") {
    values.push(...Object.values(titles).filter((value): value is string => typeof value === "string"));
  }
  const synonyms = record.title_synonyms;
  if (Array.isArray(synonyms)) {
    values.push(...synonyms.filter((value): value is string => typeof value === "string"));
  }
  return values;
}

function tokenSimilarity(left: string, right: string) {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection / union;
}

function tokenSet(value: string) {
  return new Set(value.split(/\s+/).filter((token) => token.length >= 2));
}

function parseOmdbYear(value: string | undefined) {
  const year = Number(value?.match(/\b(19\d{2}|20\d{2})\b/)?.[1]);
  return Number.isFinite(year) ? year : undefined;
}

function addQuery(queries: string[], value: string) {
  const query = cleanSearchTitle(value);
  if (!query) {
    return;
  }
  const key = query.toLowerCase();
  if (!queries.some((item) => item.toLowerCase() === key)) {
    queries.push(query);
  }
}

function uniqueQueryTexts(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const value of values) {
    const text = value?.replace(/\s+/g, " ").trim();
    if (!text) {
      continue;
    }
    const key = text.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(text);
  }
  return results;
}

function cleanSearchTitle(value: string) {
  return value
    .replace(/\[[^\]]*]/g, " ")
    .replace(/\([^)]*(?:1080p|2160p|720p|x26[45]|hevc|avc|web-dl|baha|b-global)[^)]*\)/gi, " ")
    .replace(/\bS\d{1,2}E\d{1,4}\b/gi, " ")
    .replace(/\s+-\s*(?:EP?)?\d{1,4}\s*(?:v\d+)?\s*$/i, " ")
    .replace(/\.(?:mkv|mp4|avi|mov|webm|m4v|ts)$/i, " ")
    .replace(releaseEditionPattern, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isReleaseLikeMetadataQuery(value: string) {
  return (
    /\[[^\]]+]/.test(value) ||
    /\bS\d{1,2}E\d{1,4}\b/i.test(value) ||
    /\.(?:mkv|mp4|avi|mov|webm|m4v|ts)$/i.test(value) ||
    /\b(?:1080p|2160p|720p|x26[45]|hevc|avc|web-?dl|webrip|baha|cr)\b/i.test(value)
  );
}

function scoreMetadataQueryValue(value: string, releaseLike: boolean) {
  const clean = cleanSearchTitle(value);
  if (!clean) {
    return -100;
  }
  let score = 0;
  if (/[\u3040-\u30ff]/.test(clean)) {
    score += 80;
  }
  if (/[\u3400-\u9fff]/.test(clean)) {
    score += 62;
  }
  if (/[a-z]/i.test(clean)) {
    score += 42;
  }
  if (/\s+\/\s+|｜|\|/.test(clean)) {
    score += 12;
  }
  if (clean.length >= 6 && clean.length <= 90) {
    score += 24;
  }
  if (clean.length > 140) {
    score -= 70;
  } else if (clean.length > 90) {
    score -= 35;
  }
  if (releaseLike) {
    score -= 45;
  }
  if (/\bS\d{1,2}E\d{1,4}\b/i.test(value)) {
    score -= 20;
  }
  if (!/\s/.test(clean) && clean.length <= 12) {
    score -= 8;
  }
  return score;
}

function shouldReplaceReleaseEditionTitle(currentTitle: string, providerTitle: string | undefined) {
  releaseEditionPattern.lastIndex = 0;
  return Boolean(
    providerTitle?.trim() &&
      releaseEditionPattern.test(currentTitle) &&
      providerTitle.trim().length >= 2,
  );
}

function stripSeasonWords(value: string) {
  return value
    .replace(/\s*第\s*[一二三四五六七八九十\d]+\s*[季期]\s*/g, " ")
    .replace(/\s*S(?:eason)?\s*\d+\s*/gi, " ")
    .replace(/\s*\d+(?:st|nd|rd|th)\s+Season\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectSeason(value: string) {
  const chinese = value.match(/第\s*([一二三四五六七八九十\d]+)\s*[季期]/);
  if (chinese?.[1]) {
    return Number(chinese[1]) || romanNumerals.get(chinese[1]) || null;
  }
  const english = value.match(/(?:Season\s*|S)(\d+)|(\d+)(?:st|nd|rd|th)\s+Season/i);
  const numeric = english?.[1] ?? english?.[2];
  return numeric ? Number(numeric) : null;
}

function ordinal(value: number) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return `${value}st`;
  }
  if (mod10 === 2 && mod100 !== 12) {
    return `${value}nd`;
  }
  if (mod10 === 3 && mod100 !== 13) {
    return `${value}rd`;
  }
  return `${value}th`;
}

function cleanDescription(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
