import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { replaceSeasonCatalog } from "@/lib/season-catalog";

const syncSeasonCatalogSchema = z.object({
  provider: z.enum(["tvdb", "anidb"]).default("tvdb"),
  externalId: z.string().trim().min(1).optional(),
  dryRun: z.boolean().default(false),
});

type TvdbEpisodeLike = Record<string, unknown>;

export type SyncedSeasonCatalogEntry = {
  seasonNumber: number;
  episodeCount: number;
  absoluteStart: number | null;
  absoluteEnd: number | null;
  provider: "tvdb" | "anidb";
  sourceUrl: string | null;
  confidence: number;
};

export async function syncSeasonCatalogFromProvider(mediaTitleId: string, input: unknown) {
  const payload = syncSeasonCatalogSchema.parse(input);
  await prisma.mediaTitle.findUniqueOrThrow({
    where: { id: mediaTitleId },
    select: { id: true },
  });

  if (payload.provider === "anidb") {
    throw new Error("AniDB season catalog sync is not enabled yet. Configure AniDB now; UDP lookup will be added as a dedicated adapter.");
  }

  const entries = await fetchTvdbSeasonCatalog(mediaTitleId, payload.externalId);
  if (!payload.dryRun) {
    await replaceSeasonCatalog(mediaTitleId, {
      provider: "tvdb",
      entries,
    });
  }

  return {
    mediaTitleId,
    provider: "tvdb",
    dryRun: payload.dryRun,
    entries,
  };
}

async function fetchTvdbSeasonCatalog(mediaTitleId: string, externalId?: string) {
  const settings = await getAppSettings();
  if (!settings.metadataProviders.theTvdbApiKey) {
    throw new Error("TheTVDB API key is not configured.");
  }
  const tvdbSeriesId = externalId ?? await findLinkedTvdbSeriesId(mediaTitleId);
  if (!tvdbSeriesId) {
    throw new Error("TheTVDB series id is required. Link metadata first or pass externalId.");
  }
  const token = await loginTheTvdb(settings.metadataProviders.theTvdbApiKey);
  const episodes = await fetchTvdbEpisodes(tvdbSeriesId, token);
  const entries = buildCatalogEntriesFromTvdbEpisodes(tvdbSeriesId, episodes);
  if (entries.length === 0) {
    throw new Error("TheTVDB did not return regular season episodes for this series.");
  }
  return entries;
}

async function findLinkedTvdbSeriesId(mediaTitleId: string) {
  const link = await prisma.metadataLink.findFirst({
    where: {
      mediaId: mediaTitleId,
      provider: { in: ["tvdb", "thetvdb", "thetvdb_series"] },
    },
    orderBy: { createdAt: "desc" },
  });
  return link?.externalId ?? null;
}

async function loginTheTvdb(apiKey: string) {
  const response = await fetch("https://api4.thetvdb.com/v4/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: apiKey }),
  });
  if (!response.ok) {
    throw new Error(`TheTVDB login failed with HTTP ${response.status}.`);
  }
  const body = await response.json() as Record<string, unknown>;
  const data = isRecord(body.data) ? body.data : body;
  const token = typeof data.token === "string" ? data.token : null;
  if (!token) {
    throw new Error("TheTVDB login response did not include a token.");
  }
  return token;
}

async function fetchTvdbEpisodes(seriesId: string, token: string) {
  const episodes: TvdbEpisodeLike[] = [];
  for (let page = 0; page < 100; page += 1) {
    const response = await fetch(
      `https://api4.thetvdb.com/v4/series/${encodeURIComponent(seriesId)}/episodes/official?page=${page}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!response.ok) {
      throw new Error(`TheTVDB episode request failed with HTTP ${response.status}.`);
    }
    const body = await response.json() as Record<string, unknown>;
    const pageEpisodes = extractTvdbEpisodes(body);
    episodes.push(...pageEpisodes);
    if (!hasNextPage(body)) {
      break;
    }
  }
  return episodes;
}

export function buildCatalogEntriesFromTvdbEpisodes(
  seriesId: string,
  episodes: TvdbEpisodeLike[],
): SyncedSeasonCatalogEntry[] {
  const seasons = new Map<number, Map<number, number | null>>();

  for (const episode of episodes) {
    const seasonNumber = positiveInteger(
      episode.seasonNumber ??
        episode.airedSeason ??
        episode.season ??
        nestedNumber(episode, ["season", "number"]),
    );
    const episodeNumber = positiveInteger(
      episode.number ??
        episode.episodeNumber ??
        episode.airedEpisodeNumber ??
        episode.episode,
    );
    if (!seasonNumber || !episodeNumber) {
      continue;
    }
    const absoluteNumber = positiveInteger(
      episode.absoluteNumber ??
        episode.absolute_episode_number ??
        episode.absoluteEpisodeNumber,
    );
    const season = seasons.get(seasonNumber) ?? new Map<number, number | null>();
    season.set(episodeNumber, absoluteNumber);
    seasons.set(seasonNumber, season);
  }

  return [...seasons.entries()]
    .sort(([a], [b]) => a - b)
    .map(([seasonNumber, episodeMap]) => {
      const absoluteNumbers = [...episodeMap.values()].filter((value): value is number => Boolean(value));
      return {
        seasonNumber,
        episodeCount: episodeMap.size,
        absoluteStart: absoluteNumbers.length === episodeMap.size ? Math.min(...absoluteNumbers) : null,
        absoluteEnd: absoluteNumbers.length === episodeMap.size ? Math.max(...absoluteNumbers) : null,
        provider: "tvdb" as const,
        sourceUrl: `https://thetvdb.com/series/${seriesId}/seasons/official/${seasonNumber}`,
        confidence: 0.9,
      };
    });
}

function extractTvdbEpisodes(body: Record<string, unknown>) {
  const data = body.data;
  if (Array.isArray(data)) {
    return data.filter(isRecord);
  }
  if (isRecord(data)) {
    for (const key of ["episodes", "data"]) {
      const value = data[key];
      if (Array.isArray(value)) {
        return value.filter(isRecord);
      }
    }
  }
  return [];
}

function hasNextPage(body: Record<string, unknown>) {
  const links = isRecord(body.links) ? body.links : isRecord(body.data) && isRecord(body.data.links) ? body.data.links : null;
  if (!links) {
    return false;
  }
  const next = links.next;
  return next !== null && next !== undefined && next !== "";
}

function nestedNumber(record: Record<string, unknown>, path: string[]) {
  let value: unknown = record;
  for (const key of path) {
    if (!isRecord(value)) {
      return null;
    }
    value = value[key];
  }
  return value;
}

function positiveInteger(value: unknown) {
  const number = typeof value === "number" ? Math.floor(value) : Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
