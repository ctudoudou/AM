import path from "node:path";
import type { MediaType } from "@prisma/client";
import { normalizeTitleAliases } from "@/lib/anime-parser";
import { prisma } from "@/lib/db";
import { parseMediaReleaseTitle } from "@/lib/media-parser";
import { aliasesFromTitleTexts, upsertTitleAliases } from "@/lib/title-display";

type IdentityInput = {
  type: MediaType;
  title: string;
  year?: number | null;
  originalTitle?: string | null;
  aliases?: Array<string | null | undefined>;
};

export async function findExistingMediaTitle(input: IdentityInput) {
  const exact = await prisma.mediaTitle.findFirst({
    where: {
      type: input.type,
      primaryTitle: input.title,
      year: input.year ?? null,
    },
  });
  if (exact) {
    return exact;
  }

  const keys = identityKeys([
    input.title,
    input.originalTitle,
    ...(input.aliases ?? []),
  ]);
  if (keys.size === 0) {
    return null;
  }

  const candidates = await prisma.mediaTitle.findMany({
    where: {
      type: input.type,
      ...(input.year
        ? {
            OR: [{ year: input.year }, { year: null }],
          }
        : {}),
    },
    include: {
      aliases: true,
      metadata: true,
      seasons: {
        include: {
          episodes: {
            include: { files: true },
          },
        },
      },
    },
  });

  return candidates
    .map((media) => ({
      media,
      score: overlapScore(keys, createMediaIdentityKeys(media)),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || mediaQualityScore(b.media) - mediaQualityScore(a.media))[0]
    ?.media ?? null;
}

export async function addMediaTitleAliases(mediaId: string, values: Array<string | null | undefined>) {
  return upsertTitleAliases(mediaId, aliasesFromTitleTexts(values));
}

export async function mergeDuplicateAnimeTitles() {
  const media = await prisma.mediaTitle.findMany({
    where: { type: "ANIME" },
    include: {
      aliases: true,
      metadata: true,
      seasons: {
        include: {
          episodes: {
            include: { files: true },
          },
        },
      },
      organizerPlans: true,
      wantedEpisodes: true,
    },
  });
  const clusters = duplicateClusters(media);
  let merged = 0;
  const results: Array<{ targetId: string; sourceId: string; title: string }> = [];

  for (const cluster of clusters) {
    const sorted = [...cluster].sort((a, b) => mediaQualityScore(b) - mediaQualityScore(a));
    const [target, ...sources] = sorted;
    if (!target) {
      continue;
    }
    for (const source of sources) {
      await mergeMediaTitleInto(source.id, target.id);
      merged += 1;
      results.push({ targetId: target.id, sourceId: source.id, title: target.primaryTitle });
    }
  }

  return { inspected: media.length, clusters: clusters.length, merged, results };
}

async function mergeMediaTitleInto(sourceId: string, targetId: string) {
  if (sourceId === targetId) {
    return;
  }
  const [source, target] = await Promise.all([
    prisma.mediaTitle.findUniqueOrThrow({
      where: { id: sourceId },
      include: {
        aliases: true,
        metadata: true,
        seasons: {
          include: {
            episodes: {
              include: { files: true },
            },
          },
        },
        wantedEpisodes: true,
      },
    }),
    prisma.mediaTitle.findUniqueOrThrow({ where: { id: targetId }, include: { aliases: true } }),
  ]);

  await addMediaTitleAliases(target.id, [
    source.primaryTitle,
    source.originalTitle,
    ...source.aliases.map((alias) => alias.title),
    ...mediaFileIdentityValues(source),
  ]);

  for (const link of source.metadata) {
    await prisma.metadataLink
      .update({
        where: { id: link.id },
        data: { mediaId: target.id },
      })
      .catch(async () => {
        await prisma.metadataLink.delete({ where: { id: link.id } }).catch(() => null);
      });
  }

  for (const season of source.seasons) {
    const targetSeason = await prisma.season.upsert({
      where: { mediaId_number: { mediaId: target.id, number: season.number } },
      create: { mediaId: target.id, number: season.number, title: season.title },
      update: { title: season.title ?? undefined },
    });
    for (const episode of season.episodes) {
      const targetEpisode = await prisma.episode.upsert({
        where: { seasonId_number: { seasonId: targetSeason.id, number: episode.number } },
        create: {
          seasonId: targetSeason.id,
          number: episode.number,
          title: episode.title,
          overview: episode.overview,
          airDate: episode.airDate,
        },
        update: {
          title: episode.title ?? undefined,
          overview: episode.overview ?? undefined,
          airDate: episode.airDate ?? undefined,
        },
      });
      await prisma.mediaFile.updateMany({
        where: { episodeId: episode.id },
        data: { episodeId: targetEpisode.id },
      });
      await prisma.watchProgress.updateMany({
        where: { episodeId: episode.id },
        data: { episodeId: targetEpisode.id },
      });
    }
  }

  await prisma.organizerPlan.updateMany({
    where: { mediaTitleId: source.id },
    data: { mediaTitleId: target.id },
  });
  for (const wanted of source.wantedEpisodes) {
    await prisma.wantedEpisode
      .update({
        where: { id: wanted.id },
        data: { mediaTitleId: target.id },
      })
      .catch(async () => {
        await prisma.wantedEpisode.delete({ where: { id: wanted.id } }).catch(() => null);
      });
  }
  await prisma.mediaTitle.update({
    where: { id: target.id },
    data: {
      originalTitle: target.originalTitle ?? source.originalTitle,
      year: target.year ?? source.year,
      synopsis: target.synopsis ?? source.synopsis,
      posterUrl: target.posterUrl ?? source.posterUrl,
      backdropUrl: target.backdropUrl ?? source.backdropUrl,
      rating: target.rating ?? source.rating,
    },
  });
  await prisma.mediaTitle.delete({ where: { id: source.id } });
}

function duplicateClusters<T extends { id: string } & MediaIdentity>(media: T[]) {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const current = parent.get(id) ?? id;
    if (current === id) {
      parent.set(id, id);
      return id;
    }
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      parent.set(rootB, rootA);
    }
  };
  const owners = new Map<string, string>();
  for (const item of media) {
    parent.set(item.id, item.id);
    for (const key of createMediaIdentityKeys(item)) {
      const owner = owners.get(key);
      if (owner) {
        union(owner, item.id);
      } else {
        owners.set(key, item.id);
      }
    }
  }
  const byRoot = new Map<string, T[]>();
  for (const item of media) {
    const root = find(item.id);
    byRoot.set(root, [...(byRoot.get(root) ?? []), item]);
  }
  return [...byRoot.values()].filter((cluster) => cluster.length > 1);
}

export type MediaIdentity = {
  primaryTitle: string;
  originalTitle: string | null;
  aliases: Array<{ title: string }>;
  metadata: Array<{ provider: string; externalId: string }>;
  seasons: Array<{
    episodes: Array<{
      title: string | null;
      files: Array<{ originalName: string; absolutePath: string }>;
    }>;
  }>;
  posterUrl?: string | null;
  year?: number | null;
};

export function createMediaIdentityKeys(media: MediaIdentity) {
  return identityKeys([
    media.primaryTitle,
    media.originalTitle,
    ...media.aliases.map((alias) => alias.title),
    ...mediaFileIdentityValues(media),
  ]);
}

function mediaFileIdentityValues(media: Pick<MediaIdentity, "seasons">) {
  return media.seasons.flatMap((season) =>
    season.episodes.flatMap((episode) =>
      episode.files.flatMap((file) => [
        episode.title,
        file.originalName,
        path.basename(file.absolutePath, path.extname(file.absolutePath)),
        parseMediaReleaseTitle(file.originalName, "ANIME").parsedTitle,
      ]),
    ),
  );
}

function identityKeys(values: Array<string | null | undefined>) {
  const keys = new Set<string>();
  for (const value of values) {
    for (const alias of normalizeTitleAliases(value ?? "")) {
      const key = normalizeIdentityKey(alias);
      if (isUsefulIdentityKey(key)) {
        keys.add(key);
      }
    }
  }
  return keys;
}

function overlapScore(input: Set<string>, candidate: Set<string>) {
  let score = 0;
  for (const key of input) {
    if (candidate.has(key)) {
      score += key.length >= 12 ? 3 : 1;
    }
  }
  return score;
}

function normalizeIdentityKey(value: string) {
  return value
    .toLowerCase()
    .replace(/\bgyaru\b/g, "gal")
    .replace(/\bs\d{1,2}e\d{1,4}(?:\.\d+)?\b/g, " ")
    .replace(/\s+\d{1,4}(?:\.\d+)?\s+(?:mkv|mp4|avi|mov|webm|m4v|ts)$/i, " ")
    .replace(/\s+(?:mkv|mp4|avi|mov|webm|m4v|ts)$/i, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulIdentityKey(value: string) {
  return hasEnoughTitleSignal(value) &&
    !/^(?:season|episode|special|ncop|nced|op|ed|ova|movie|anime|\d+)$/.test(value) &&
    /[a-z0-9\u3400-\u9fff\u3040-\u30ff]/i.test(value);
}

function hasEnoughTitleSignal(value: string) {
  const cjkCount = [...value].filter((char) => /[\u3400-\u9fff]/.test(char)).length;
  if (cjkCount >= 4) {
    return true;
  }
  return value.length >= 6;
}

function mediaQualityScore(media: {
  metadata?: unknown[];
  aliases?: unknown[];
  posterUrl?: string | null;
  year?: number | null;
  seasons?: Array<{ episodes: Array<{ files: unknown[] }> }>;
}) {
  const fileCount = media.seasons?.reduce(
    (sum, season) => sum + season.episodes.reduce((inner, episode) => inner + episode.files.length, 0),
    0,
  ) ?? 0;
  return (
    (media.metadata?.length ?? 0) * 100 +
    (media.posterUrl ? 20 : 0) +
    (media.year ? 10 : 0) +
    (media.aliases?.length ?? 0) +
    fileCount
  );
}
