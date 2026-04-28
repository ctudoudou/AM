"use client";

import { useMemo, useState } from "react";
import { Download, Loader2, RefreshCw, Search, X } from "lucide-react";
import { getMessages } from "@/messages";
import type { Locale } from "@/lib/i18n";
import type { EpisodeCoverageItem } from "@/lib/wanted-episodes";

type MissingEpisodesPayload = {
  mediaTitleId: string;
  episodes: EpisodeCoverageItem[];
  missingCount: number;
};

export function MissingEpisodesPanel({
  initialCoverage,
  locale,
  mediaTitleId,
}: {
  initialCoverage: MissingEpisodesPayload;
  locale: Locale;
  mediaTitleId: string;
}) {
  const t = getMessages(locale);
  const [coverage, setCoverage] = useState(initialCoverage);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const visibleEpisodes = useMemo(
    () => coverage.episodes.filter((episode) => episode.status !== "AVAILABLE"),
    [coverage.episodes],
  );

  async function scan() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/library/anime/${mediaTitleId}/missing-episodes/scan`, {
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

  async function runWantedAction(wantedId: string, action: "download" | "ignore") {
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
      {visibleEpisodes.length === 0 ? (
        <div className="empty-panel">{t.noMissingEpisodes}</div>
      ) : (
        <div className="missing-episode-list">
          {visibleEpisodes.map((episode) => (
            <article
              className={`missing-episode-row status-${episode.status.toLowerCase()}`}
              key={`${episode.seasonNumber}-${episode.episodeNumber}`}
            >
              <div className="episode-index">
                <strong>{String(episode.episodeNumber).padStart(2, "0")}</strong>
                <span>S{String(episode.seasonNumber).padStart(2, "0")}</span>
              </div>
              <div>
                <strong>{labelForStatus(episode.status, t)}</strong>
                <small>{episode.candidateTitle || episode.reason || t.noCandidateFound}</small>
              </div>
              <div className="missing-episode-actions">
                {episode.wantedId && episode.candidateId ? (
                  <button
                    disabled={busyId === episode.wantedId}
                    onClick={() => void runWantedAction(episode.wantedId as string, "download")}
                    type="button"
                  >
                    {busyId === episode.wantedId ? <Loader2 size={14} /> : <Download size={14} />}
                    {t.download}
                  </button>
                ) : (
                  <button disabled type="button">
                    <Search size={14} />
                    {t.noCandidateFound}
                  </button>
                )}
                {episode.wantedId ? (
                  <button
                    disabled={busyId === episode.wantedId}
                    onClick={() => void runWantedAction(episode.wantedId as string, "ignore")}
                    type="button"
                  >
                    <X size={14} />
                    {t.ignoreEpisode}
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
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
  if (status === "NEEDS_REVIEW") {
    return t.needsReview;
  }
  if (status === "IGNORED") {
    return t.ignored;
  }
  return t.missing;
}
