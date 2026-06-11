import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { prisma } from "@/lib/db";
import { isLocale } from "@/lib/i18n";
import { getAppSettings } from "@/lib/settings";
import { resolveMediaDisplayTitle } from "@/lib/title-display";
import { getMessages } from "@/messages";
import { WatchClient } from "./watch-client";

const directPlayExtensions = new Set([".mp4", ".m4v", ".webm", ".mov"]);

export default async function WatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; episodeId: string }>;
  searchParams?: Promise<{ file?: string | string[] }>;
}) {
  const { locale, episodeId } = await params;
  const query = await searchParams;
  const requestedFileId = Array.isArray(query?.file) ? query?.file[0] : query?.file;

  if (!isLocale(locale)) {
    notFound();
  }

  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    include: {
      files: { orderBy: { updatedAt: "desc" } },
      progress: true,
      season: {
        include: {
          media: {
            include: {
              aliases: true,
              seasons: {
                orderBy: { number: "asc" },
                include: {
                  episodes: {
                    orderBy: { number: "asc" },
                    include: {
                      files: { orderBy: { updatedAt: "desc" } },
                      progress: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!episode || episode.files.length === 0) {
    notFound();
  }

  const t = getMessages(locale);
  const settings = await getAppSettings();
  const media = episode.season.media;
  const mediaDisplay =
    media.type === "ANIME"
      ? resolveMediaDisplayTitle(media, settings)
      : { displayTitle: media.primaryTitle };
  const activeKey = media.type === "MOVIE" ? "movies" : media.type === "TV" ? "tv" : "anime";
  const detailPath =
    media.type === "MOVIE"
      ? `/${locale}/movies/${media.id}`
      : media.type === "TV"
        ? `/${locale}/tv/${media.id}`
        : `/${locale}/anime/${media.id}`;
  type WatchFile = (typeof episode.files)[number];
  type WatchSeason = (typeof episode.season.media.seasons)[number];
  type WatchEpisode = WatchSeason["episodes"][number];
  const file = episode.files.find((item: WatchFile) => item.id === requestedFileId) ?? selectPlayableFile(episode.files);
  const episodes = episode.season.media.seasons
    .flatMap((season: WatchSeason) =>
      season.episodes
        .filter((item: WatchEpisode) => item.files.length > 0)
        .map((item: WatchEpisode) => ({
          id: item.id,
          number: item.number,
          title: item.title,
          seasonNumber: season.number,
          progress: item.progress[0]
            ? {
                positionSec: item.progress[0].positionSec,
                durationSec: item.progress[0].durationSec,
                completed: item.progress[0].completed,
              }
            : null,
          files: item.files.map((mediaFile: WatchEpisode["files"][number]) => ({
            id: mediaFile.id,
            originalName: mediaFile.originalName,
            resolution: mediaFile.resolution,
            sourceResolution: mediaFile.sourceResolution,
            videoCodec: mediaFile.videoCodec,
            audioCodec: mediaFile.audioCodec,
            subtitleGroup: mediaFile.subtitleGroup,
            playbackMode: mediaFile.playbackMode,
            transcodeStatus: mediaFile.transcodeStatus,
          })),
        })),
    );
  const currentIndex = episodes.findIndex((item: (typeof episodes)[number]) => item.id === episode.id);
  const previousEpisode = currentIndex > 0 ? episodes[currentIndex - 1] : null;
  const nextEpisode = currentIndex >= 0 ? episodes[currentIndex + 1] ?? null : null;

  return (
    <main className="app-shell">
      <AppSidebar activeKey={activeKey} locale={locale} />
      <section className="watch-content">
        <header className="watch-heading">
          <div>
            <p>{mediaDisplay.displayTitle}</p>
            <h1>
              {media.type === "MOVIE"
                ? ""
                : `S${String(episode.season.number).padStart(2, "0")}E${String(episode.number).padStart(2, "0")} · `}
              {episode.title || t.unknownTitle}
            </h1>
          </div>
          <a href={detailPath}>{t.backToLibrary}</a>
        </header>
        <WatchClient
          currentEpisode={{
            id: episode.id,
            number: episode.number,
            title: episode.title,
            seasonNumber: episode.season.number,
          }}
          episodeId={episode.id}
          episodes={episodes}
          initialPositionSec={episode.progress[0]?.positionSec ?? 0}
          locale={locale}
          mediaFileId={file.id}
          nextEpisode={nextEpisode ? { id: nextEpisode.id, number: nextEpisode.number, seasonNumber: nextEpisode.seasonNumber, title: nextEpisode.title } : null}
          previousEpisode={previousEpisode ? { id: previousEpisode.id, number: previousEpisode.number, seasonNumber: previousEpisode.seasonNumber, title: previousEpisode.title } : null}
        />
      </section>
    </main>
  );
}

function selectPlayableFile<T extends { absolutePath: string }>(files: T[]) {
  return (
    files.find((file) => directPlayExtensions.has(extname(file.absolutePath))) ??
    files[0]
  );
}

function extname(filePath: string) {
  const index = filePath.lastIndexOf(".");
  return index >= 0 ? filePath.slice(index).toLowerCase() : "";
}
