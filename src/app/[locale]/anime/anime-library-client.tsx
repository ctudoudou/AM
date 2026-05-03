"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Image as ImageIcon,
  Loader2,
  Play,
  Search,
  ShieldAlert,
  WandSparkles,
} from "lucide-react";
import { getMessages } from "@/messages";
import type { Locale } from "@/lib/i18n";

type AnimeTitle = {
  id: string;
  primaryTitle: string;
  displayTitle: string;
  secondaryTitles: string[];
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

type AnimeAuditIssue = {
  mediaId: string;
  severity: "HIGH" | "MEDIUM";
  reason: string;
  evidence: string[];
};

type AnimeLibraryTag =
  | "ALL"
  | "METADATA_ISSUE"
  | "MISSING_POSTER"
  | "IN_PROGRESS"
  | "NOT_STARTED"
  | "MULTI_SEASON"
  | "WITH_SYNOPSIS";
type AnimeLibrarySort = "TITLE" | "YEAR_DESC" | "EPISODES_DESC" | "PROGRESS";

export function AnimeLibraryClient({ locale }: { locale: Locale }) {
  const t = getMessages(locale);
  const [titles, setTitles] = useState<AnimeTitle[]>([]);
  const [auditIssues, setAuditIssues] = useState<AnimeAuditIssue[]>([]);
  const [query, setQuery] = useState("");
  const [yearFilter, setYearFilter] = useState("ALL");
  const [tagFilter, setTagFilter] = useState<AnimeLibraryTag>("ALL");
  const [sortMode, setSortMode] = useState<AnimeLibrarySort>("TITLE");
  const [loading, setLoading] = useState(true);
  const [refreshingMetadata, setRefreshingMetadata] = useState(false);
  const [repairingLibrary, setRepairingLibrary] = useState(false);
  const [repairMessage, setRepairMessage] = useState("");
  const [auditing, setAuditing] = useState(false);
  const [error, setError] = useState("");
  const issueByMediaId = useMemo(() => {
    const map = new Map<string, AnimeAuditIssue>();
    for (const issue of auditIssues) {
      const existing = map.get(issue.mediaId);
      if (!existing || issue.severity === "HIGH") {
        map.set(issue.mediaId, issue);
      }
    }
    return map;
  }, [auditIssues]);
  const yearOptions = useMemo(
    () =>
      [...new Set(titles.map((title) => title.year).filter((year): year is number => Boolean(year)))]
        .sort((a, b) => b - a),
    [titles],
  );
  const visibleTitles = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return titles
      .filter((title) => {
        if (needle && !matchesAnimeQuery(title, needle)) {
          return false;
        }
        if (yearFilter !== "ALL" && String(title.year ?? "") !== yearFilter) {
          return false;
        }
        return matchesAnimeTag(title, tagFilter, issueByMediaId);
      })
      .sort((a, b) => compareAnimeTitles(a, b, sortMode, locale));
  }, [issueByMediaId, locale, query, sortMode, tagFilter, titles, yearFilter]);

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

  const auditLibrary = useCallback(async () => {
    setAuditing(true);
    try {
      const response = await fetch("/api/library/anime/audit");
      if (!response.ok) {
        throw new Error(t.metadataAuditError);
      }
      const body = (await response.json()) as { issues: AnimeAuditIssue[] };
      setAuditIssues(body.issues);
    } catch (auditError) {
      setError(auditError instanceof Error ? auditError.message : t.metadataAuditError);
    } finally {
      setAuditing(false);
    }
  }, [t.metadataAuditError]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load();
      void auditLibrary();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [auditLibrary, load]);

  async function refreshMetadata() {
    setRefreshingMetadata(true);
    setRepairMessage("");
    try {
      const response = await fetch("/api/library/anime/metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onlyMissing: true }),
      });
      if (!response.ok) {
        throw new Error(t.metadataRefreshError);
      }
      await load();
      await auditLibrary();
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : t.metadataRefreshError);
    } finally {
      setRefreshingMetadata(false);
    }
  }

  async function repairLibrary() {
    setRepairingLibrary(true);
    setRepairMessage("");
    setError("");
    try {
      const mergeResponse = await fetch("/api/jobs/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job: "library.mergeDuplicateAnimeTitles" }),
      });
      if (!mergeResponse.ok) {
        throw new Error(t.repairAnimeLibraryError);
      }
      const metadataResponse = await fetch("/api/library/anime/metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onlyMissing: true }),
      });
      if (!metadataResponse.ok) {
        throw new Error(t.repairAnimeLibraryError);
      }
      await load();
      await auditLibrary();
      setRepairMessage(t.repairAnimeLibraryDone);
    } catch (repairError) {
      setError(repairError instanceof Error ? repairError.message : t.repairAnimeLibraryError);
    } finally {
      setRepairingLibrary(false);
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
            <span>{t.year}</span>
            <select onChange={(event) => setYearFilter(event.target.value)} value={yearFilter}>
              <option value="ALL">{t.allYears}</option>
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t.tag}</span>
            <select
              onChange={(event) => setTagFilter(event.target.value as AnimeLibraryTag)}
              value={tagFilter}
            >
              {animeLibraryTagOptions(t).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t.sortBy}</span>
            <select
              onChange={(event) => setSortMode(event.target.value as AnimeLibrarySort)}
              value={sortMode}
            >
              <option value="TITLE">{t.sortTitle}</option>
              <option value="YEAR_DESC">{t.sortYearDesc}</option>
              <option value="EPISODES_DESC">{t.sortEpisodesDesc}</option>
              <option value="PROGRESS">{t.sortProgress}</option>
            </select>
          </label>
        </div>
        <span className="library-result-count">
          {visibleTitles.length} {t.titles}
        </span>
        <div className="toolbar-actions library-actions">
          <button
            disabled={auditing || repairingLibrary}
            onClick={() => void auditLibrary()}
            type="button"
          >
            {auditing ? <Loader2 size={14} /> : <ShieldAlert size={14} />}
            {auditIssues.length > 0
              ? `${t.libraryAuditIssues} ${auditIssues.length}`
              : t.auditLibrary}
          </button>
          <button
            disabled={refreshingMetadata || repairingLibrary}
            onClick={() => void refreshMetadata()}
            type="button"
          >
            {refreshingMetadata ? <Loader2 size={14} /> : <ImageIcon size={14} />}
            {t.refreshMetadata}
          </button>
          <button disabled={repairingLibrary} onClick={() => void repairLibrary()} type="button">
            {repairingLibrary ? <Loader2 size={14} /> : <WandSparkles size={14} />}
            {t.repairAnimeLibrary}
          </button>
        </div>
      </div>
      {error ? <div className="settings-alert">{error}</div> : null}
      {repairMessage ? <div className="settings-success">{repairMessage}</div> : null}
      {visibleTitles.length === 0 ? (
        <div className="empty-panel">{t.noAnimeTitles}</div>
      ) : (
        <section className="anime-grid">
          {visibleTitles.map((title) => {
            const progress = title.nextEpisode?.progress;
            const auditIssue = issueByMediaId.get(title.id);
            const progressPercent =
              progress?.durationSec && progress.durationSec > 0
                ? Math.round((progress.positionSec / progress.durationSec) * 100)
                : 0;
            return (
              <article className="anime-card" key={title.id}>
                <a
                  aria-label={title.displayTitle}
                  className="anime-poster anime-poster-link"
                  href={`/${locale}/anime/${title.id}`}
                  style={{
                    backgroundImage: title.posterUrl ? `url(${title.posterUrl})` : undefined,
                  }}
                >
                  {!title.posterUrl ? (
                    <FallbackCover title={title.displayTitle} />
                  ) : null}
                </a>
                <div className="anime-card-body">
                  <a className="anime-title-link" href={`/${locale}/anime/${title.id}`}>
                    <h2>{splitTitle(title.displayTitle).primary}</h2>
                  </a>
                  {subtitleForTitle(title) ? (
                    <small>{subtitleForTitle(title)}</small>
                  ) : null}
                  <p>
                    {title.year ?? "-"} · {title.seasonCount} {t.seasons} ·{" "}
                    {title.episodeCount} {t.episodes}
                  </p>
                  {title.synopsis ? <small>{title.synopsis}</small> : null}
                  {auditIssue ? (
                    <a className="anime-audit-warning" href={`/${locale}/anime/${title.id}`}>
                      <ShieldAlert size={13} />
                      {auditIssue.severity === "HIGH"
                        ? t.metadataMismatch
                        : t.metadataNeedsAttention}
                    </a>
                  ) : null}
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

function subtitleForTitle(title: AnimeTitle) {
  const split = splitTitle(title.displayTitle);
  return split.secondary || title.secondaryTitles[0] || title.originalTitle || null;
}

function matchesAnimeQuery(title: AnimeTitle, needle: string) {
  return [title.displayTitle, title.primaryTitle, title.originalTitle ?? "", ...title.secondaryTitles].some((value) =>
    value.toLowerCase().includes(needle),
  );
}

function matchesAnimeTag(
  title: AnimeTitle,
  tag: AnimeLibraryTag,
  issueByMediaId: Map<string, AnimeAuditIssue>,
) {
  if (tag === "ALL") {
    return true;
  }
  if (tag === "METADATA_ISSUE") {
    return issueByMediaId.has(title.id);
  }
  if (tag === "MISSING_POSTER") {
    return !title.posterUrl;
  }
  if (tag === "IN_PROGRESS") {
    return hasWatchProgress(title);
  }
  if (tag === "NOT_STARTED") {
    return !hasWatchProgress(title);
  }
  if (tag === "MULTI_SEASON") {
    return title.seasonCount > 1;
  }
  return Boolean(title.synopsis);
}

function compareAnimeTitles(
  a: AnimeTitle,
  b: AnimeTitle,
  sortMode: AnimeLibrarySort,
  locale: Locale,
): number {
  if (sortMode === "YEAR_DESC") {
    return (b.year ?? 0) - (a.year ?? 0) || compareAnimeTitles(a, b, "TITLE", locale);
  }
  if (sortMode === "EPISODES_DESC") {
    return b.episodeCount - a.episodeCount || compareAnimeTitles(a, b, "TITLE", locale);
  }
  if (sortMode === "PROGRESS") {
    return progressRank(b) - progressRank(a) || compareAnimeTitles(a, b, "TITLE", locale);
  }
  return a.displayTitle.localeCompare(b.displayTitle, locale);
}

function hasWatchProgress(title: AnimeTitle) {
  const progress = title.nextEpisode?.progress;
  return Boolean(progress && progress.positionSec > 0 && !progress.completed);
}

function progressRank(title: AnimeTitle) {
  const progress = title.nextEpisode?.progress;
  if (!progress) {
    return 0;
  }
  if (progress.completed) {
    return 1;
  }
  return 2;
}

function animeLibraryTagOptions(t: ReturnType<typeof getMessages>) {
  return [
    { value: "ALL", label: t.allTags },
    { value: "METADATA_ISSUE", label: t.libraryTagMetadataIssue },
    { value: "MISSING_POSTER", label: t.libraryTagMissingPoster },
    { value: "IN_PROGRESS", label: t.libraryTagInProgress },
    { value: "NOT_STARTED", label: t.libraryTagNotStarted },
    { value: "MULTI_SEASON", label: t.libraryTagMultiSeason },
    { value: "WITH_SYNOPSIS", label: t.libraryTagWithSynopsis },
  ] satisfies Array<{ value: AnimeLibraryTag; label: string }>;
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
