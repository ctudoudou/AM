"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Play, Search } from "lucide-react";
import { getMessages } from "@/messages";
import type { Locale } from "@/lib/i18n";

type AnimeTitle = {
  id: string;
  primaryTitle: string;
  originalTitle?: string | null;
  year?: number | null;
  synopsis?: string | null;
  posterUrl?: string | null;
  backdropUrl?: string | null;
  seasonCount: number;
  episodeCount: number;
  nextEpisode?: {
    id: string;
    number: number;
    title?: string | null;
    mediaFileId?: string | null;
    progress?: { positionSec: number; durationSec?: number | null; completed: boolean } | null;
  } | null;
};

export function AnimeLibraryClient({ locale }: { locale: Locale }) {
  const t = getMessages(locale);
  const [titles, setTitles] = useState<AnimeTitle[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const visibleTitles = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return titles;
    }
    return titles.filter((title) =>
      [title.primaryTitle, title.originalTitle ?? ""].some((value) =>
        value.toLowerCase().includes(needle),
      ),
    );
  }, [query, titles]);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/library/anime");
      if (!response.ok) {
        throw new Error(t.animeLibraryLoadError);
      }
      const body = (await response.json()) as { titles: AnimeTitle[] };
      setTitles(body.titles);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t.animeLibraryLoadError);
    } finally {
      setLoading(false);
    }
  }, [t.animeLibraryLoadError]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  if (loading) {
    return (
      <div className="settings-loading">
        <Loader2 size={18} />
        {t.loading}
      </div>
    );
  }

  return (
    <div className="library-workspace">
      <div className="library-toolbar">
        <label>
          <Search size={14} />
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.search}
            value={query}
          />
        </label>
        <span>
          {visibleTitles.length} {t.titles}
        </span>
      </div>
      {error ? <div className="settings-alert">{error}</div> : null}
      {visibleTitles.length === 0 ? (
        <div className="empty-panel">{t.noAnimeTitles}</div>
      ) : (
        <section className="anime-grid">
          {visibleTitles.map((title) => {
            const progress = title.nextEpisode?.progress;
            const progressPercent =
              progress?.durationSec && progress.durationSec > 0
                ? Math.round((progress.positionSec / progress.durationSec) * 100)
                : 0;
            return (
              <article className="anime-card" key={title.id}>
                <a
                  aria-label={title.primaryTitle}
                  className="anime-poster anime-poster-link"
                  href={`/${locale}/anime/${title.id}`}
                  style={{
                    backgroundImage: title.posterUrl ? `url(${title.posterUrl})` : undefined,
                  }}
                >
                  {!title.posterUrl ? (
                    <FallbackCover title={title.primaryTitle} />
                  ) : null}
                </a>
                <div className="anime-card-body">
                  <a className="anime-title-link" href={`/${locale}/anime/${title.id}`}>
                    <h2>{splitTitle(title.primaryTitle).primary}</h2>
                  </a>
                  {splitTitle(title.primaryTitle).secondary ? (
                    <small>{splitTitle(title.primaryTitle).secondary}</small>
                  ) : null}
                  <p>
                    {title.year ?? "-"} · {title.seasonCount} {t.seasons} ·{" "}
                    {title.episodeCount} {t.episodes}
                  </p>
                  {title.synopsis ? <small>{title.synopsis}</small> : null}
                  {title.nextEpisode?.mediaFileId ? (
                    <a className="anime-play-link" href={`/${locale}/watch/${title.nextEpisode.id}`}>
                      <Play size={14} />
                      {progress?.completed
                        ? t.rewatch
                        : progressPercent > 0
                          ? `${t.continueWatching} ${progressPercent}%`
                          : t.playNow}
                    </a>
                  ) : null}
                </div>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
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
