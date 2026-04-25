import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type MetadataMatch = {
  provider: "anilist" | "tmdb" | "bangumi" | "fallback";
  externalId: string;
  title: string;
  originalTitle?: string;
  year?: number;
  synopsis?: string;
  posterUrl?: string;
  backdropUrl?: string;
  language?: string;
  score: number;
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
  original_name?: string | null;
  first_air_date?: string | null;
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
  const providerResults = await searchAnimeMetadata(query);

  const results =
    providerResults.length > 0
      ? providerResults
      : [
          {
            provider: "fallback" as const,
            externalId: group.id,
            title: group.displayTitle,
            score: 0.55,
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

  return results.sort((a, b) => b.score - a.score)[0];
}

export async function refreshAnimeLibraryMetadata(input?: { titleId?: string; onlyMissing?: boolean }) {
  const titles = await prisma.mediaTitle.findMany({
    where: {
      type: "ANIME",
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
    results.push(await refreshAnimeMetadata(title.id));
  }

  return {
    checked: titles.length,
    updated: results.filter((result) => result.updated).length,
    results,
  };
}

export async function refreshAnimeMetadata(titleId: string) {
  const media = await prisma.mediaTitle.findUniqueOrThrow({
    where: { id: titleId },
    include: {
      aliases: true,
    },
  });
  const queries = buildAnimeMetadataQueries([
    media.primaryTitle,
    media.originalTitle,
    ...media.aliases.map((alias) => alias.title),
  ]);
  const matches = [];

  for (const query of queries) {
    matches.push(...(await searchAnimeMetadata(query)));
    if (matches.some((match) => match.posterUrl)) {
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

  const updated = await prisma.mediaTitle.update({
    where: { id: media.id },
    data: {
      originalTitle: media.originalTitle ?? best.originalTitle,
      year: media.year ?? best.year,
      synopsis: media.synopsis ?? best.synopsis,
      posterUrl: best.posterUrl ?? media.posterUrl,
      backdropUrl: best.backdropUrl ?? media.backdropUrl,
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

export function buildAnimeMetadataQueries(values: Array<string | null | undefined>) {
  const queries: string[] = [];

  for (const value of values) {
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

export async function searchAnimeMetadata(query: string): Promise<MetadataMatch[]> {
  const providerResults = (
    await Promise.allSettled([
      searchAniList(query),
      searchBangumi(query),
      searchTmdb(query),
    ])
  ).flatMap((result) => (result.status === "fulfilled" ? result.value : []));

  return providerResults
    .map((result) => ({
      ...result,
      synopsis: result.synopsis ? cleanDescription(result.synopsis) : undefined,
    }))
    .sort((a, b) => Number(Boolean(b.posterUrl)) - Number(Boolean(a.posterUrl)) || b.score - a.score);
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

async function searchTmdb(query: string): Promise<MetadataMatch[]> {
  const token = process.env.TMDB_API_KEY;
  if (!token) {
    return [];
  }
  const url = new URL("https://api.themoviedb.org/3/search/tv");
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
    provider: "tmdb" as const,
    externalId: String(item.id),
    title: item.name || item.original_name || query,
    originalTitle: optionalString(item.original_name),
    year: item.first_air_date ? Number(String(item.first_air_date).slice(0, 4)) : undefined,
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

function selectBestMetadataMatch(results: MetadataMatch[]) {
  return [...results].sort(
    (a, b) =>
      Number(Boolean(b.posterUrl)) - Number(Boolean(a.posterUrl)) ||
      Number(Boolean(b.backdropUrl)) - Number(Boolean(a.backdropUrl)) ||
      b.score - a.score,
  )[0];
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

function cleanSearchTitle(value: string) {
  return value
    .replace(/\[[^\]]*]/g, " ")
    .replace(/\([^)]*(?:1080p|2160p|720p|x26[45]|hevc|avc|web-dl|baha|b-global)[^)]*\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
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
