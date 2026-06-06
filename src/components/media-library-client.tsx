"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Play, RefreshCw, Search } from "lucide-react";
import { getMessages } from "@/messages";
import type { Locale } from "@/lib/i18n";

type MediaTitle = {
  id: string;
  type: "ANIME" | "MOVIE" | "TV";
  primaryTitle: string;
  originalTitle?: string | null;
  year?: number | null;
  synopsis?: string | null;
  posterUrl?: string | null;
  seasonCount: number;
  episodeCount: number;
  nextEpisode?: {
    id: string;
    number: number;
    title?: string | null;
    mediaFileId?: string | null;
  } | null;
};

export function MediaLibraryClient({
  apiPath,
  detailBasePath,
  emptyMessage,
  locale,
}: {
  apiPath: string;
  detailBasePath: string;
  emptyMessage: string;
  locale: Locale;
}) {
  const t = getMessages(locale);
  const [titles, setTitles] = useState<MediaTitle[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
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
      const response = await fetch(apiPath);
      if (!response.ok) {
        throw new Error(t.libraryLoadError);
      }
      const body = (await response.json()) as { titles: MediaTitle[] };
      setTitles(body.titles);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t.libraryLoadError);
    } finally {
      setLoading(false);
    }
  }, [apiPath, t.libraryLoadError]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  async function scan() {
    setScanning(true);
    setError("");
    try {
      const response = await fetch("/api/library/scan", { method: "POST" });
      if (!response.ok) {
        throw new Error(t.libraryScanError);
      }
      await load();
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : t.libraryScanError);
    } finally {
      setScanning(false);
    }
  }

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
        <div className="toolbar-actions">
          <span>
            {visibleTitles.length} {t.titles}
          </span>
          <button disabled={scanning} onClick={() => void scan()} type="button">
            {scanning ? <Loader2 size={14} /> : <RefreshCw size={14} />}
            {t.scanLibrary}
          </button>
        </div>
      </div>
      {error ? <div className="settings-alert">{error}</div> : null}
      {visibleTitles.length === 0 ? (
        <div className="empty-panel">{emptyMessage}</div>
      ) : (
        <section className="anime-grid">
          {visibleTitles.map((title) => (
            <article className="anime-card" key={title.id}>
              <a
                aria-label={title.primaryTitle}
                className="anime-poster"
                href={`/${locale}${detailBasePath}/${title.id}`}
                style={{
                  backgroundImage: title.posterUrl ? `url(${title.posterUrl})` : undefined,
                }}
              >
                {!title.posterUrl ? (
                  title.type === "MOVIE" ? (
                    <Play size={28} />
                  ) : (
                    <span>{title.primaryTitle.slice(0, 1)}</span>
                  )
                ) : null}
              </a>
              <div className="anime-card-body">
                <h2>
                  <a href={`/${locale}${detailBasePath}/${title.id}`}>{title.primaryTitle}</a>
                </h2>
                <p>
                  {title.type === "MOVIE"
                    ? `${title.year ?? "-"} · ${title.episodeCount} ${t.fileVersions}`
                    : `${title.year ?? "-"} · ${title.seasonCount} ${t.seasons} · ${title.episodeCount} ${t.episodes}`}
                </p>
                {title.synopsis ? <small>{title.synopsis}</small> : null}
                {title.nextEpisode?.mediaFileId ? (
                  <a href={`/${locale}/watch/${title.nextEpisode.id}`}>
                    <Play size={14} />
                    {t.playNow}
                  </a>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
