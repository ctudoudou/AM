import { notFound } from "next/navigation";
import { ArrowLeft, Play } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { prisma } from "@/lib/db";
import { isLocale } from "@/lib/i18n";
import { getAppSettings } from "@/lib/settings";
import { resolveMediaDisplayTitle } from "@/lib/title-display";
import { getMessages } from "@/messages";
import { AnimeTitleActions } from "./anime-title-actions";

const directPlayExtensions = new Set([".mp4", ".m4v", ".webm", ".mov"]);

export default async function AnimeTitlePage({
  params,
}: {
  params: Promise<{ locale: string; titleId: string }>;
}) {
  const { locale, titleId } = await params;

  if (!isLocale(locale)) {
    notFound();
  }

  const media = await prisma.mediaTitle.findUnique({
    where: { id: titleId },
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
  });

  if (!media || media.type !== "ANIME") {
    notFound();
  }

  const t = getMessages(locale);
  const settings = await getAppSettings();
  const display = resolveMediaDisplayTitle(media, settings);
  const title = splitTitle(display.displayTitle);
  const episodeCount = media.seasons.reduce(
    (count, season) =>
      count + season.episodes.filter((episode) => episode.files.length > 0).length,
    0,
  );
  const playableEpisodes = media.seasons.flatMap((season) =>
    season.episodes.filter((episode) => episode.files.length > 0),
  );
  const nextEpisode =
    playableEpisodes.find((episode) => !episode.progress[0]?.completed) ??
    playableEpisodes[0] ??
    null;
  const nextProgress = nextEpisode?.progress[0];
  const nextProgressPercent =
    nextProgress?.durationSec && nextProgress.durationSec > 0
      ? Math.round((nextProgress.positionSec / nextProgress.durationSec) * 100)
      : 0;

  return (
    <main className="app-shell">
      <AppSidebar activeKey="anime" locale={locale} />
      <section className="settings-content">
        <header className="anime-detail-shell">
          <div className="anime-detail-nav">
            <a className="anime-back-link" href={`/${locale}/anime`}>
              <ArrowLeft size={14} />
              {t.backToLibrary}
            </a>
          </div>
          <div className="anime-detail-main">
            <div
              className="anime-poster anime-detail-poster"
              style={{
                backgroundImage: media.posterUrl ? `url(${media.posterUrl})` : undefined,
              }}
            >
              {!media.posterUrl ? <FallbackCover title={display.displayTitle} /> : null}
            </div>
            <div className="anime-detail-copy">
              <p>{t.anime}</p>
              <h1>{title.primary}</h1>
              {title.secondary || display.secondaryTitles[0] ? (
                <small>{title.secondary || display.secondaryTitles[0]}</small>
              ) : null}
              <span>
                {media.year ?? "-"} · {media.seasons.length} {t.seasons} · {episodeCount}{" "}
                {t.episodes}
              </span>
              {media.synopsis ? <em>{media.synopsis}</em> : null}
              <AnimeTitleActions
                customDisplayTitle={media.customDisplayTitle}
                locale={locale}
                titleDisplayMode={media.titleDisplayMode}
                titleId={media.id}
              />
            </div>
            {nextEpisode ? (
              <a className="anime-detail-play" href={`/${locale}/watch/${nextEpisode.id}`}>
                <Play size={15} />
                {nextProgress?.completed
                  ? t.rewatch
                  : nextProgressPercent > 0
                    ? `${t.continueWatching} ${nextProgressPercent}%`
                    : t.playNow}
              </a>
            ) : null}
          </div>
        </header>

        <section className="episode-browser">
          <div className="episode-browser-heading">
            <div>
              <h2>{t.episodeList}</h2>
              <p>{t.selectEpisodeDescription}</p>
            </div>
            <span>
              {episodeCount} {t.episodes}
            </span>
          </div>
          {media.seasons.map((season) => (
            <div className="episode-season" key={season.id}>
              <h3>
                {t.seasons} {String(season.number).padStart(2, "0")}
              </h3>
              <div className="episode-list">
                {season.episodes.map((episode) => {
                  const file = selectPlayableFile(episode.files);
                  const progress = episode.progress[0];
                  const progressPercent =
                    progress?.durationSec && progress.durationSec > 0
                      ? Math.round((progress.positionSec / progress.durationSec) * 100)
                      : 0;

                  return (
                    <article className="episode-row" key={episode.id}>
                      <div className="episode-index">
                        <strong>{String(episode.number).padStart(2, "0")}</strong>
                        <span>{t.episode}</span>
                      </div>
                      <div className="episode-summary">
                        <strong>{episode.title || display.displayTitle}</strong>
                        <small>
                          {episode.files.length} {t.fileVersions}
                          {progressPercent > 0 ? ` · ${progressPercent}%` : ""}
                        </small>
                      </div>
                      <div className="episode-files">
                        {episode.files.slice(0, 3).map((item) => (
                          <span className="file-chip" key={item.id}>
                            {formatFileLabel(item)}
                          </span>
                        ))}
                      </div>
                      {file ? (
                        <a href={`/${locale}/watch/${episode.id}`}>
                          <Play size={14} />
                          {progress?.completed
                            ? t.rewatch
                            : progressPercent > 0
                              ? t.continueWatching
                              : t.playNow}
                        </a>
                      ) : (
                        <span className="episode-unavailable">{t.noPlayableFiles}</span>
                      )}
                    </article>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      </section>
    </main>
  );
}

function selectPlayableFile<T extends { absolutePath: string }>(files: T[]) {
  return (
    files.find((file) => directPlayExtensions.has(extname(file.absolutePath))) ??
    files[0] ??
    null
  );
}

function formatFileLabel(file: {
  originalName: string;
  resolution: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
}) {
  return [file.resolution, file.videoCodec, file.audioCodec].filter(Boolean).join(" / ") ||
    file.originalName;
}

function splitTitle(title: string) {
  const [primary, ...rest] = title
    .split(/\s+\/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  return {
    primary: primary || title,
    secondary: rest.join(" / "),
  };
}

function FallbackCover({ title }: { title: string }) {
  const { primary, secondary } = splitTitle(title);
  return (
    <span className="anime-fallback-cover">
      <b>{primary.slice(0, 2)}</b>
      <small>{secondary || primary}</small>
    </span>
  );
}

function extname(filePath: string) {
  const index = filePath.lastIndexOf(".");
  return index >= 0 ? filePath.slice(index).toLowerCase() : "";
}
