"use client";

import { Download, Link2, Loader2, Search } from "lucide-react";
import { useState } from "react";
import type { Locale } from "@/lib/i18n";
import { getMessages } from "@/messages";

const MAX_SELECTED_EPISODES = 24;

type Inspection = {
  planId: string;
  provider: string;
  providerName: string;
  sourceItemId: string;
  sourceUrl: string;
  kind: "detail" | "play";
  title: string;
  description: string | null;
  seasonNumber: number;
  episodes: Array<{
    key: string;
    number: number;
    label: string;
    sources: Array<{ id: string; label: string }>;
  }>;
};

type ImportSummary = {
  queued: number;
  skipped: number;
  failed: number;
  results: Array<{
    episodeKey: string;
    episodeNumber: number;
    status: "queued" | "skipped" | "failed";
    message: string;
  }>;
};

export function VideoSourceImportPanel({
  locale,
  onQueued,
}: {
  locale: Locale;
  onQueued: () => void;
}) {
  const t = getMessages(locale);
  const [url, setUrl] = useState("");
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [inspecting, setInspecting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  async function inspect() {
    setError("");
    setSummary(null);
    setInspecting(true);
    try {
      const response = await fetch("/api/video-sources/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.message || t.videoSourceInspectError);
      }
      const next = body as Inspection;
      setInspection(next);
      setUrl(next.sourceUrl);
      setSelected(
        next.episodes.slice(0, MAX_SELECTED_EPISODES).map((episode) => episode.key),
      );
    } catch (inspectError) {
      setInspection(null);
      setSelected([]);
      setError(inspectError instanceof Error ? inspectError.message : t.videoSourceInspectError);
    } finally {
      setInspecting(false);
    }
  }

  async function queueSelected() {
    if (!inspection || selected.length === 0) {
      return;
    }
    setError("");
    setSummary(null);
    setImporting(true);
    try {
      const response = await fetch("/api/video-sources/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: inspection.sourceUrl,
          planId: inspection.planId,
          episodeKeys: selected,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.message || t.videoSourceImportError);
      }
      setSummary(body as ImportSummary);
      onQueued();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : t.videoSourceImportError);
    } finally {
      setImporting(false);
    }
  }

  function toggleEpisode(key: string) {
    setSelected((current) => {
      if (current.includes(key)) {
        return current.filter((candidate) => candidate !== key);
      }
      return current.length >= MAX_SELECTED_EPISODES ? current : [...current, key];
    });
  }

  return (
    <section className="video-source-import">
      <div className="video-source-import-heading">
        <div className="video-source-import-icon"><Link2 size={16} /></div>
        <div>
          <strong>{t.videoSourceImportTitle}</strong>
          <span>{t.videoSourceImportDescription}</span>
        </div>
      </div>
      <form
        className="video-source-import-form"
        onSubmit={(event) => {
          event.preventDefault();
          void inspect();
        }}
      >
        <input
          aria-label={t.videoSourceUrl}
          disabled={inspecting || importing}
          onChange={(event) => {
            setUrl(event.target.value);
            setInspection(null);
            setSelected([]);
            setSummary(null);
          }}
          placeholder={t.videoSourceUrlPlaceholder}
          type="url"
          value={url}
        />
        <button disabled={inspecting || importing || !url.trim()} type="submit">
          {inspecting ? <Loader2 className="spin" size={14} /> : <Search size={14} />}
          {inspecting ? t.videoSourceInspecting : t.videoSourceInspect}
        </button>
      </form>
      {error ? <div className="settings-alert">{error}</div> : null}
      {inspection ? (
        <div className="video-source-preview">
          <div className="video-source-preview-heading">
            <div>
              <strong>{inspection.title}</strong>
              <span>
                {inspection.providerName} · {inspection.kind === "detail"
                  ? t.videoSourceDetailPage
                  : t.videoSourcePlayPage}
              </span>
            </div>
            <div className="video-source-selection-actions">
              <button
                disabled={importing}
                onClick={() => setSelected(
                  inspection.episodes
                    .slice(0, MAX_SELECTED_EPISODES)
                    .map((item) => item.key),
                )}
                type="button"
              >
                {t.videoSourceSelectAll}
              </button>
              <button disabled={importing} onClick={() => setSelected([])} type="button">
                {t.videoSourceClearSelection}
              </button>
            </div>
          </div>
          {inspection.description ? <p>{inspection.description}</p> : null}
          <div className="video-source-episodes">
            {inspection.episodes.map((episode) => (
              <label key={episode.key}>
                <input
                  checked={selected.includes(episode.key)}
                  disabled={
                    importing ||
                    (!selected.includes(episode.key) && selected.length >= MAX_SELECTED_EPISODES)
                  }
                  onChange={() => toggleEpisode(episode.key)}
                  type="checkbox"
                />
                <span>{episode.label}</span>
                <small>{episode.sources.length} {t.videoSourceLines}</small>
              </label>
            ))}
          </div>
          <div className="video-source-import-actions">
            <span>
              {t.videoSourceSelected}: {selected.length} / {MAX_SELECTED_EPISODES}
            </span>
            <button
              disabled={importing || selected.length === 0}
              onClick={() => void queueSelected()}
              type="button"
            >
              {importing ? <Loader2 className="spin" size={14} /> : <Download size={14} />}
              {importing ? t.videoSourceImporting : t.videoSourceDownloadSelected}
            </button>
          </div>
        </div>
      ) : null}
      {summary ? (
        <div className="video-source-import-summary">
          <strong>{t.videoSourceImportComplete}</strong>
          <span>{t.videoSourceQueued}: {summary.queued}</span>
          <span>{t.videoSourceSkipped}: {summary.skipped}</span>
          <span>{t.videoSourceFailed}: {summary.failed}</span>
          {summary.results.some((result) => result.status === "failed") ? (
            <details>
              <summary>{t.videoSourceFailureDetails}</summary>
              {summary.results
                .filter((result) => result.status === "failed")
                .map((result) => (
                  <p key={result.episodeKey}>{result.episodeNumber}: {result.message}</p>
                ))}
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
