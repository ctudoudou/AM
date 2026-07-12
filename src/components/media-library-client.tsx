"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { DatabaseZap, Images, Loader2, Play, RefreshCw, Search } from "lucide-react";
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

type MetadataRefreshResult = {
  checked: number;
  updated: number;
  results: Array<{ reason?: string }>;
};

export function MediaLibraryClient({
  apiPath,
  detailBasePath,
  emptyMessage,
  locale,
  mediaType,
}: {
  apiPath: string;
  detailBasePath: string;
  emptyMessage: string;
  locale: Locale;
  mediaType: "MOVIE" | "TV";
}) {
  const t = getMessages(locale);
  const [titles, setTitles] = useState<MediaTitle[]>([]);
  const [failedPosterIds, setFailedPosterIds] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [metadataFilter, setMetadataFilter] = useState<"ALL" | "MISSING_POSTER">("ALL");
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [maintenanceAction, setMaintenanceAction] = useState<"repair" | "refreshMetadata" | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const visibleTitles = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return titles
      .filter(
        (title) =>
          metadataFilter !== "MISSING_POSTER" || !posterIsAvailable(title, failedPosterIds),
      )
      .filter(
        (title) =>
          !needle ||
          [title.primaryTitle, title.originalTitle ?? ""].some((value) =>
            value.toLowerCase().includes(needle),
          ),
      );
  }, [failedPosterIds, metadataFilter, query, titles]);
  const missingPosterCount = titles.filter(
    (title) => !posterIsAvailable(title, failedPosterIds),
  ).length;

  const load = useCallback(async () => {
    try {
      const response = await fetch(apiPath);
      if (!response.ok) {
        throw new Error(t.libraryLoadError);
      }
      const body = (await response.json()) as { titles: MediaTitle[] };
      setTitles(body.titles);
      setFailedPosterIds(new Set());
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
    setStatus("");
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

  async function maintain(action: "repair" | "refreshMetadata") {
    setMaintenanceAction(action);
    setError("");
    setStatus("");
    try {
      const response = await fetch("/api/library/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, mediaType }),
      });
      if (!response.ok) {
        throw new Error(action === "repair" ? t.repairMediaLibraryError : t.metadataRefreshError);
      }
      const body = (await response.json()) as {
        result:
          | MetadataRefreshResult
          | {
              normalized: { updated: number };
              merged: { merged: number };
              metadata: MetadataRefreshResult;
            };
      };
      const maintenance = "metadata" in body.result ? body.result : null;
      const metadata = maintenance?.metadata ?? (body.result as MetadataRefreshResult);
      const unresolved = metadata.results.filter((result) => result.reason !== "UPDATED").length;
      setStatus(
        action === "repair" && maintenance
          ? `${t.repairMediaLibraryDone} ${t.normalizedTitles}: ${maintenance.normalized.updated}, ${t.mergedTitles}: ${maintenance.merged.merged}, ${t.metadataUpdated}: ${metadata.updated}, ${t.metadataUnresolved}: ${unresolved}.`
          : `${t.metadataRefreshDone} ${t.metadataUpdated}: ${metadata.updated}, ${t.metadataUnresolved}: ${unresolved}.`,
      );
      await load();
    } catch (maintenanceError) {
      setError(
        maintenanceError instanceof Error
          ? maintenanceError.message
          : action === "repair"
            ? t.repairMediaLibraryError
            : t.metadataRefreshError,
      );
    } finally {
      setMaintenanceAction(null);
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
        <label className="library-search-field">
          <Search size={14} />
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.search}
            value={query}
          />
        </label>
        <div className="library-filter-controls">
          <label>
            <span>{t.tag}</span>
            <select
              aria-label={t.tag}
              onChange={(event) => setMetadataFilter(event.target.value as "ALL" | "MISSING_POSTER")}
              value={metadataFilter}
            >
              <option value="ALL">{t.allTags}</option>
              <option value="MISSING_POSTER">
                {t.libraryTagMissingPoster} ({missingPosterCount})
              </option>
            </select>
          </label>
        </div>
        <div className="toolbar-actions">
          <span>
            {visibleTitles.length} {t.titles}
          </span>
          <button
            disabled={scanning || maintenanceAction !== null}
            onClick={() => void scan()}
            type="button"
          >
            {scanning ? <Loader2 size={14} /> : <RefreshCw size={14} />}
            {t.scanLibrary}
          </button>
          <button
            disabled={maintenanceAction !== null || scanning}
            onClick={() => void maintain("refreshMetadata")}
            type="button"
          >
            {maintenanceAction === "refreshMetadata" ? <Loader2 size={14} /> : <Images size={14} />}
            {t.refreshMetadata}
          </button>
          <button
            disabled={maintenanceAction !== null || scanning}
            onClick={() => void maintain("repair")}
            type="button"
          >
            {maintenanceAction === "repair" ? <Loader2 size={14} /> : <DatabaseZap size={14} />}
            {t.repairMediaLibrary}
          </button>
        </div>
      </div>
      {error ? <div className="settings-alert">{error}</div> : null}
      {status ? <div className="settings-success">{status}</div> : null}
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
              >
                {posterIsAvailable(title, failedPosterIds) ? (
                  <Image
                    alt=""
                    className="library-poster-image"
                    height={750}
                    onError={() => {
                      setFailedPosterIds((current) => new Set(current).add(title.id));
                    }}
                    src={title.posterUrl!}
                    unoptimized
                    width={500}
                  />
                ) : (
                  title.type === "MOVIE" ? (
                    <Play size={28} />
                  ) : (
                    <span>{title.primaryTitle.slice(0, 1)}</span>
                  )
                )}
              </a>
              <div className="anime-card-body">
                <h2>
                  <a href={`/${locale}${detailBasePath}/${title.id}`}>{title.primaryTitle}</a>
                </h2>
                {!posterIsAvailable(title, failedPosterIds) ? (
                  <span className="candidate-policy">{t.libraryTagMissingPoster}</span>
                ) : null}
                <p>
                  {title.type === "MOVIE"
                    ? `${title.year ?? "-"} · ${title.episodeCount} ${t.fileVersions}`
                    : `${title.year ?? "-"} · ${title.seasonCount} ${t.seasons} · ${title.episodeCount} ${t.episodes}`}
                </p>
                {title.synopsis ? <small>{title.synopsis}</small> : null}
                {title.nextEpisode?.mediaFileId ? (
                  <a className="anime-play-link" href={`/${locale}/watch/${title.nextEpisode.id}`}>
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

function posterIsAvailable(title: MediaTitle, failedPosterIds: Set<string>) {
  return Boolean(title.posterUrl && !failedPosterIds.has(title.id));
}
