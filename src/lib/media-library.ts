import type { MediaType } from "@prisma/client";
import { prisma } from "@/lib/db";

export async function getMediaLibrary(type: MediaType) {
  const titles = await prisma.mediaTitle.findMany({
    where: { type },
    orderBy: { updatedAt: "desc" },
    include: {
      seasons: {
        orderBy: { number: "asc" },
        include: {
          episodes: {
            orderBy: { number: "asc" },
            include: {
              files: { orderBy: { updatedAt: "desc" }, take: 1 },
              progress: true,
            },
          },
        },
      },
    },
  });

  return titles.map((title) => {
    const episodes = title.seasons.flatMap((season) => season.episodes);
    const playableEpisodes = episodes.filter((episode) => episode.files.length > 0);
    const nextEpisode =
      playableEpisodes.find((episode) => !episode.progress[0]?.completed) ??
      playableEpisodes[0] ??
      null;

    return {
      id: title.id,
      type: title.type,
      primaryTitle: title.primaryTitle,
      originalTitle: title.originalTitle,
      year: title.year,
      synopsis: title.synopsis,
      posterUrl: title.posterUrl,
      backdropUrl: title.backdropUrl,
      rating: title.rating,
      seasonCount: title.seasons.length,
      episodeCount: playableEpisodes.length,
      updatedAt: title.updatedAt,
      nextEpisode: nextEpisode
        ? {
            id: nextEpisode.id,
            number: nextEpisode.number,
            title: nextEpisode.title,
            progress: nextEpisode.progress[0] ?? null,
            mediaFileId: nextEpisode.files[0]?.id ?? null,
          }
        : null,
    };
  });
}
