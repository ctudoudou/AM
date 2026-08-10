"use client";

import { useMemo, useState } from "react";
import { Download, Loader2, RotateCcw, RefreshCw, Search, X } from "lucide-react";
import { getMessages } from "@/messages";
import type { Locale } from "@/lib/i18n";
import type {
  HistoryBackfillEpisodeResult,
  HistoryBackfillResult,
} from "@/lib/history-backfill";
import type { EpisodeCoverageItem } from "@/lib/wanted-episodes";
import type { WantedSearchResult, WantedSearchSourceError } from "@/lib/wanted-rss-search";

type MissingEpisodesPayload = {
  mediaTitleId: string;
  episodes: EpisodeCoverageItem[];
  missingCount: number;
};

type WantedSearchState = {
  loading: boolean;
  results: WantedSearchResult[];
  sourceErrors: WantedSearchSourceError[];
  error: string;
};

type HistoryBackfillPayload = {
  mediaTitleId: string;
  title: string;
  seasonNumber: number;
  episodeStart: number;
  episodeEnd: number;
  episodes: HistoryBackfillEpisodeResult[];
};

export function MissingEpisodesPanel({
  libraryKind = "anime",
  initialCoverage,
  locale,
  mediaTitleId,
}: {
  libraryKind?: "anime" | "tv";
  initialCoverage: MissingEpisodesPayload;
  locale: Locale;
  mediaTitleId: string;
}) {
  const t = getMessages(locale);
  const [coverage, setCoverage] = useState(initialCoverage);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [searches, setSearches] = useState<Record<string, WantedSearchState>>({});
  const [backfillDraft, setBackfillDraft] = useState(() => {
    const firstMissing = initialCoverage.episodes.find((episode) => episode.status !== "AVAILABLE");
    return {
      seasonNumber: firstMissing?.seasonNumber ?? initialCoverage.episodes[0]?.seasonNumber ?? 1,
      episodeStart: firstMissing?.episodeNumber ?? 1,
      episodeEnd: firstMissing?.episodeNumber ?? 1,
    };
  });
  const [backfillLoading, setBackfillLoading] = useState(false);
  const [backfillResult, setBackfillResult] = useState<HistoryBackfillPayload | null>(null);
  const [error, setError] = useState("");
  const visibleEpisodes = useMemo(
    () => coverage.episodes.filter((episode) => episode.status !== "AVAILABLE"),
    [coverage.episodes],
  );
  const safeBackfillSelections = useMemo(() => {
    if (!backfillResult) {
      return [];
    }
    return backfillResult.episodes.flatMap((episode) => {
      const result = episode.results.find((item) => item.safeToDownload);
      return result ? [{ episode, result }] : [];
    });
  }, [backfillResult]);

  async function scan() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/library/${libraryKind}/${mediaTitleId}/missing-episodes/scan`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(t.missingEpisodeActionError);
      }
      setCoverage((await response.json()) as MissingEpisodesPayload);
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : t.missingEpisodeActionError);
    } finally {
      setLoading(false);
    }
  }

  async function runWantedAction(wantedId: string, action: "download" | "ignore" | "restore") {
    setBusyId(wantedId);
    setError("");
    try {
      const response = await fetch(`/api/wanted-episodes/${wantedId}/${action}`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(t.missingEpisodeActionError);
      }
      await scan();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t.missingEpisodeActionError);
    } finally {
      setBusyId(null);
    }
  }

  async function searchWantedSources(wantedId: string) {
    setSearches((current) => ({
      ...current,
      [wantedId]: {
        loading: true,
        results: current[wantedId]?.results ?? [],
        sourceErrors: current[wantedId]?.sourceErrors ?? [],
        error: "",
      },
    }));
    setError("");
    try {
      const response = await fetch(`/api/wanted-episodes/${wantedId}/search`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(t.missingEpisodeActionError);
      }
      const body = (await response.json()) as {
        results: WantedSearchResult[];
        sourceErrors?: WantedSearchSourceError[];
      };
      setSearches((current) => ({
        ...current,
        [wantedId]: {
          loading: false,
          results: body.results,
          sourceErrors: body.sourceErrors ?? [],
          error: "",
        },
      }));
    } catch (searchError) {
      setSearches((current) => ({
        ...current,
        [wantedId]: {
          loading: false,
          results: current[wantedId]?.results ?? [],
          sourceErrors: current[wantedId]?.sourceErrors ?? [],
          error: searchError instanceof Error ? searchError.message : t.missingEpisodeActionError,
        },
      }));
    }
  }

  async function selectWantedResult(wantedId: string, result: WantedSearchResult) {
    setBusyId(`${wantedId}:${result.key}`);
    setError("");
    try {
      const response = await fetch(`/api/wanted-episodes/${wantedId}/select-download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
      });
      if (!response.ok) {
        throw new Error(t.downloadCreateError);
      }
      await scan();
    } catch (selectError) {
      setError(selectError instanceof Error ? selectError.message : t.downloadCreateError);
    } finally {
      setBusyId(null);
    }
  }

  async function searchHistoryBackfill() {
    setBackfillLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/library/${libraryKind}/${mediaTitleId}/history-backfill/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(backfillDraft),
      });
      if (!response.ok) {
        throw new Error(t.historyBackfillError);
      }
      setBackfillResult((await response.json()) as HistoryBackfillPayload);
      await scan();
    } catch (backfillError) {
      setError(backfillError instanceof Error ? backfillError.message : t.historyBackfillError);
    } finally {
      setBackfillLoading(false);
    }
  }

  async function selectHistoryBackfillResult(episode: HistoryBackfillEpisodeResult, result: HistoryBackfillResult) {
    setBusyId(`history:${episode.episodeNumber}:${result.key}`);
    setError("");
    try {
      await queueHistoryBackfillDownload(episode, result);
      await scan();
    } catch (selectError) {
      setError(selectError instanceof Error ? selectError.message : t.downloadCreateError);
    } finally {
      setBusyId(null);
    }
  }

  async function selectSafeHistoryBackfillResults() {
    if (safeBackfillSelections.length === 0) {
      return;
    }
    setBusyId("history:bulk");
    setError("");
    try {
      for (const selection of safeBackfillSelections) {
        await queueHistoryBackfillDownload(selection.episode, selection.result);
      }
      await scan();
    } catch (selectError) {
      setError(selectError instanceof Error ? selectError.message : t.downloadCreateError);
    } finally {
      setBusyId(null);
    }
  }

  async function queueHistoryBackfillDownload(episode: HistoryBackfillEpisodeResult, result: HistoryBackfillResult) {
    const response = await fetch("/api/history-backfill/select-download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mediaTitleId,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        result,
      }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.message || t.downloadCreateError);
    }
  }

  return (
    <section className="missing-episodes-panel">
      <div className="episode-browser-heading">
        <div>
          <h2>{t.missingEpisodes}</h2>
          <p>{t.missingEpisodesDescription}</p>
        </div>
        <button disabled={loading} onClick={() => void scan()} type="button">
          {loading ? <Loader2 size={14} /> : <RefreshCw size={14} />}
          {t.scanMissingEpisodes}
        </button>
      </div>
      {error ? <div className="settings-alert">{error}</div> : null}
      <div className="history-backfill-panel">
        <div>
          <strong>{t.historyBackfill}</strong>
          <span>{t.historyBackfillDescription}</span>
        </div>
        <label>
          <span>{t.seasons}</span>
          <input
            min={1}
            onChange={(event) =>
              setBackfillDraft((current) => ({
                ...current,
                seasonNumber: Number(event.target.value),
              }))
            }
            type="number"
            value={backfillDraft.seasonNumber}
          />
        </label>
        <label>
          <span>{t.episodeStart}</span>
          <input
            min={1}
            onChange={(event) =>
              setBackfillDraft((current) => ({
                ...current,
                episodeStart: Number(event.target.value),
              }))
            }
            type="number"
            value={backfillDraft.episodeStart}
          />
        </label>
        <label>
          <span>{t.episodeEnd}</span>
          <input
            min={1}
            onChange={(event) =>
              setBackfillDraft((current) => ({
                ...current,
                episodeEnd: Number(event.target.value),
              }))
            }
            type="number"
            value={backfillDraft.episodeEnd}
          />
        </label>
        <button disabled={backfillLoading} onClick={() => void searchHistoryBackfill()} type="button">
          {backfillLoading ? <Loader2 size={14} /> : <Search size={14} />}
          {t.searchHistoryBackfill}
        </button>
      </div>
      {backfillResult ? (
        <div className="history-backfill-results">
          <div className="wanted-search-heading">
            <div>
              <strong>
                {t.historyBackfillResults} · S{String(backfillResult.seasonNumber).padStart(2, "0")}{" "}
                EP{backfillResult.episodeStart}-{backfillResult.episodeEnd}
              </strong>
              <span>{t.historyBackfillStrictHint}</span>
            </div>
            <button
              disabled={safeBackfillSelections.length === 0 || busyId === "history:bulk"}
              onClick={() => void selectSafeHistoryBackfillResults()}
              type="button"
            >
              {busyId === "history:bulk" ? <Loader2 size={14} /> : <Download size={14} />}
              {t.downloadAllSafeHistoryBackfill} ({safeBackfillSelections.length})
            </button>
          </div>
          {backfillResult.episodes.map((episode) => (
            <div className="history-backfill-episode" key={`${episode.seasonNumber}-${episode.episodeNumber}`}>
              <strong>
                S{String(episode.seasonNumber).padStart(2, "0")}E
                {String(episode.episodeNumber).padStart(2, "0")}
              </strong>
              {episode.results.length === 0 ? <p>{t.noWantedSearchResults}</p> : null}
              {episode.results.slice(0, 5).map((result) => (
                <article className="wanted-search-result" key={result.key}>
                  <div>
                    <div className="wanted-search-meta">
                      <span>{result.sourceName}</span>
                      <span>{result.safeToDownload ? t.safeToDownload : t.requiresReview}</span>
                      <span>{result.identity.numberingScheme}</span>
                      {result.parsed.resolution ? <span>{result.parsed.resolution}</span> : null}
                      <span title={result.availability?.reason}>
                        {formatTorrentAvailability(result, t)}
                      </span>
                    </div>
                    <strong>{result.title}</strong>
                    <small>
                      {[
                        result.parsed.subtitleGroup,
                        result.identity.rawEpisode
                          ? `${t.episode}${result.identity.rawEpisode}`
                          : null,
                        result.identity.episodeOffset > 0
                          ? `${t.episodeOffset} ${result.identity.episodeOffset}`
                          : null,
                        result.size,
                        result.seeders !== null ? `Seed ${result.seeders}` : null,
                        result.safetyReason,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </div>
                  <button
                    disabled={
                      !result.safeToDownload ||
                      busyId === `history:${episode.episodeNumber}:${result.key}`
                    }
                    onClick={() => void selectHistoryBackfillResult(episode, result)}
                    type="button"
                  >
                    {busyId === `history:${episode.episodeNumber}:${result.key}` ? (
                      <Loader2 size={14} />
                    ) : (
                      <Download size={14} />
                    )}
                    {result.safeToDownload ? t.selectWantedResult : t.reviewRequired}
                  </button>
                </article>
              ))}
            </div>
          ))}
        </div>
      ) : null}
      {visibleEpisodes.length === 0 ? (
        <div className="empty-panel">{t.noMissingEpisodes}</div>
      ) : (
        <div className="missing-episode-list">
          {visibleEpisodes.map((episode) => {
            const wantedId = episode.wantedId;
            const searchState = wantedId ? searches[wantedId] : undefined;
            return (
              <div className="missing-episode-item" key={`${episode.seasonNumber}-${episode.episodeNumber}`}>
                <article className={`missing-episode-row status-${episode.status.toLowerCase()}`}>
                  <div className="episode-index">
                    <strong>{String(episode.episodeNumber).padStart(2, "0")}</strong>
                    <span>S{String(episode.seasonNumber).padStart(2, "0")}</span>
                  </div>
                  <div>
                    <strong>{labelForStatus(episode.status, t)}</strong>
                    <small>
                      {episode.status === "ARCHIVED"
                        ? t.archivedLibraryRepairDescription
                        : episode.candidateTitle || episode.reason || t.noCandidateFound}
                    </small>
                  </div>
                  <div className="missing-episode-actions">
                    {episode.status === "ARCHIVED" ? (
                      <button disabled type="button">
                        <RefreshCw size={14} />
                        {t.archivedLibraryRepairAction}
                      </button>
                    ) : wantedId && episode.status === "IGNORED" ? (
                      <button
                        disabled={busyId === wantedId}
                        onClick={() => void runWantedAction(wantedId, "restore")}
                        type="button"
                      >
                        {busyId === wantedId ? <Loader2 size={14} /> : <RotateCcw size={14} />}
                        {t.restoreEpisode}
                      </button>
                    ) : wantedId && episode.candidateId ? (
                      <button
                        disabled={busyId === wantedId}
                        onClick={() => void runWantedAction(wantedId, "download")}
                        type="button"
                      >
                        {busyId === wantedId ? <Loader2 size={14} /> : <Download size={14} />}
                        {t.download}
                      </button>
                    ) : wantedId ? (
                      <button
                        disabled={searchState?.loading}
                        onClick={() => void searchWantedSources(wantedId)}
                        type="button"
                      >
                        {searchState?.loading ? <Loader2 size={14} /> : <Search size={14} />}
                        {searchState?.loading ? t.searchingWantedSources : t.searchWantedSources}
                      </button>
                    ) : (
                      <button disabled type="button">
                        <Search size={14} />
                        {t.scanMissingEpisodes}
                      </button>
                    )}
                    {wantedId && !["ARCHIVED", "IGNORED"].includes(episode.status) ? (
                      <button
                        disabled={busyId === wantedId}
                        onClick={() => void runWantedAction(wantedId, "ignore")}
                        type="button"
                      >
                        <X size={14} />
                        {t.ignoreEpisode}
                      </button>
                    ) : null}
                  </div>
                </article>
                {wantedId && searchState ? (
                  <div className="wanted-search-results">
                    <div className="wanted-search-heading">
                      <strong>{t.wantedSearchResults}</strong>
                      <span>{t.wantedSearchHint}</span>
                    </div>
                    {searchState.error ? <div className="settings-alert">{searchState.error}</div> : null}
                    {!searchState.loading && searchState.results.length === 0 ? (
                      <p>{t.noWantedSearchResults}</p>
                    ) : null}
                    {!searchState.loading &&
                    searchState.results.length === 0 &&
                    searchState.sourceErrors.length > 0 ? (
                      <div className="settings-alert">
                        {t.wantedSearchSourceError}:{" "}
                        {searchState.sourceErrors
                          .slice(0, 3)
                          .map((item) => `${item.sourceName} ${item.message}`)
                          .join(" · ")}
                      </div>
                    ) : null}
                    {searchState.results.map((result) => (
                      <article className="wanted-search-result" key={result.key}>
                        <div>
                          <div className="wanted-search-meta">
                            <span>{result.sourceName}</span>
                            <span>{result.match === "strong" ? t.strongWantedMatch : t.relatedWantedMatch}</span>
                            {result.parsed.resolution ? <span>{result.parsed.resolution}</span> : null}
                            <span title={result.availability?.reason}>
                              {formatTorrentAvailability(result, t)}
                            </span>
                          </div>
                          <strong>{result.title}</strong>
                          <small>
                            {[
                              result.parsed.subtitleGroup,
                              result.parsed.episodeNumber ? `${t.episode}${result.parsed.episodeNumber}` : null,
                              result.size,
                              result.seeders !== null ? `Seed ${result.seeders}` : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </small>
                        </div>
                        <button
                          disabled={busyId === `${wantedId}:${result.key}` || result.match !== "strong"}
                          onClick={() => void selectWantedResult(wantedId, result)}
                          type="button"
                        >
                          {busyId === `${wantedId}:${result.key}` ? <Loader2 size={14} /> : <Download size={14} />}
                          {t.selectWantedResult}
                        </button>
                      </article>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function formatTorrentAvailability(result: WantedSearchResult, t: ReturnType<typeof getMessages>) {
  switch (result.availability?.status) {
    case "available":
      return t.torrentAvailabilityAvailable;
    case "reported":
      return t.torrentAvailabilityReported;
    case "unknown":
      return t.torrentAvailabilityUnknown;
    case "unavailable":
      return t.torrentAvailabilityUnavailable;
    case "not_probeable":
      return t.torrentAvailabilityNotProbeable;
    default:
      return result.seeders !== null && result.seeders > 0
        ? t.torrentAvailabilityReported
        : t.torrentAvailabilityUnknown;
  }
}

function labelForStatus(status: EpisodeCoverageItem["status"], t: ReturnType<typeof getMessages>) {
  if (status === "CANDIDATE_FOUND") {
    return t.candidateFound;
  }
  if (status === "DOWNLOADING") {
    return t.downloading;
  }
  if (status === "DOWNLOADED") {
    return t.downloadedWaitingOrganizer;
  }
  if (status === "ARCHIVED") {
    return t.archivedLibraryRepair;
  }
  if (status === "NEEDS_REVIEW") {
    return t.needsReview;
  }
  if (status === "IGNORED") {
    return t.ignored;
  }
  return t.missing;
}
