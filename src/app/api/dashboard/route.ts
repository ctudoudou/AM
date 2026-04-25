import { jsonError, jsonResponse } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getStorageSummary } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [
      continueWatching,
      recentMedia,
      recentlyFetched,
      downloads,
      subscriptions,
      storage,
    ] = await Promise.all([
      prisma.watchProgress.findMany({
        where: { completed: false },
        orderBy: { updatedAt: "desc" },
        take: 8,
        include: {
          episode: {
            include: {
              files: { orderBy: { updatedAt: "desc" }, take: 1 },
              season: { include: { media: true } },
            },
          },
        },
      }),
      prisma.mediaTitle.findMany({
        orderBy: { updatedAt: "desc" },
        take: 10,
        include: {
          seasons: {
            include: {
              episodes: {
                include: { files: { orderBy: { updatedAt: "desc" }, take: 1 } },
                orderBy: { updatedAt: "desc" },
                take: 1,
              },
            },
            orderBy: { updatedAt: "desc" },
            take: 1,
          },
        },
      }),
      prisma.releaseCandidateGroup.findMany({
        orderBy: { updatedAt: "desc" },
        take: 8,
        include: {
          _count: { select: { candidates: true, subscriptions: true } },
          candidates: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { id: true, rawTitle: true, status: true, episodeNumber: true },
          },
        },
      }),
      prisma.download.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      prisma.subscription.findMany({
        where: { enabled: true },
        orderBy: { updatedAt: "desc" },
        take: 6,
        include: { candidateGroup: true },
      }),
      getStorageSummary().catch(() => null),
    ]);

    return jsonResponse({
      continueWatching: continueWatching.map((progress) => ({
        episodeId: progress.episodeId,
        positionSec: progress.positionSec,
        durationSec: progress.durationSec,
        mediaFileId: progress.episode.files[0]?.id ?? null,
        episodeNumber: progress.episode.number,
        episodeTitle: progress.episode.title,
        seasonNumber: progress.episode.season.number,
        title: progress.episode.season.media.primaryTitle,
        posterUrl: progress.episode.season.media.posterUrl,
        backdropUrl: progress.episode.season.media.backdropUrl,
        type: progress.episode.season.media.type,
      })),
      recentMedia: recentMedia.map((media) => {
        const episode = media.seasons[0]?.episodes[0];
        return {
          id: media.id,
          type: media.type,
          title: media.primaryTitle,
          year: media.year,
          synopsis: media.synopsis,
          posterUrl: media.posterUrl,
          backdropUrl: media.backdropUrl,
          updatedAt: media.updatedAt,
          episodeId: episode?.id ?? null,
          mediaFileId: episode?.files[0]?.id ?? null,
        };
      }),
      recentlyFetched,
      downloads: Object.fromEntries(
        ["WAITING", "ACTIVE", "PAUSED", "COMPLETED", "FAILED"].map((status) => [
          status,
          downloads.find((entry) => entry.status === status)?._count._all ?? 0,
        ]),
      ),
      subscriptions: subscriptions.map((subscription) => ({
        id: subscription.id,
        title: subscription.title,
        autoDownload: subscription.autoDownload,
        frequencyMinutes: subscription.frequencyMinutes,
        candidateGroup: subscription.candidateGroup,
      })),
      storage,
    });
  } catch (error) {
    return jsonError(error);
  }
}
