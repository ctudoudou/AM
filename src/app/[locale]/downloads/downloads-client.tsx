"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Pause, Play, RefreshCw, RotateCw, Trash2 } from "lucide-react";
import { getMessages } from "@/messages";
import type { Locale } from "@/lib/i18n";

type DownloadRecord = {
  id: string;
  aria2Gid?: string | null;
  sourceUrl: string;
  title?: string | null;
  status: string;
  progress: number;
  totalBytes?: string | null;
  completedBytes?: string | null;
  downloadSpeed?: string | null;
  aria2Files?: Array<{
    path?: string;
    length?: string;
    completedLength?: string;
    selected?: string;
  }> | null;
  targetPath?: string | null;
  errorMessage?: string | null;
  archiveStatus?: string | null;
  candidate?: {
    mediaType: "ANIME" | "MOVIE" | "TV";
    parsedTitle: string;
    group?: { displayTitle: string } | null;
  } | null;
  organizerPlans?: Array<{
    id: string;
    status: string;
    reason?: string | null;
    items: Array<{ targetPath: string; conflict: boolean }>;
  }>;
};

type Aria2Overview =
  | {
      downloadSpeed: string;
      uploadSpeed: string;
      numActive: string;
      numWaiting: string;
      numStopped: string;
      numStoppedTotal: string;
    }
  | { error: string };

export function DownloadsClient({ locale }: { locale: Locale }) {
  const t = getMessages(locale);
  const [downloads, setDownloads] = useState<DownloadRecord[]>([]);
  const [aria2, setAria2] = useState<Aria2Overview | null>(null);
  const [filter, setFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const visibleDownloads = useMemo(
    () => downloads.filter((download) => filter === "ALL" || download.status === filter),
    [downloads, filter],
  );

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/downloads");
      if (!response.ok) {
        throw new Error(t.downloadsLoadError);
      }
      const body = (await response.json()) as {
        downloads: DownloadRecord[];
        aria2?: Aria2Overview;
      };
      setDownloads(body.downloads);
      setAria2(body.aria2 ?? null);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t.downloadsLoadError);
    } finally {
      setLoading(false);
    }
  }, [t.downloadsLoadError]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load();
    }, 0);
    const interval = window.setInterval(() => {
      void load();
    }, 3000);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [load]);

  async function syncDownloads() {
    await fetch("/api/jobs/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job: "downloads.syncAria2" }),
    });
    await load();
  }

  async function runDownloadAction(download: DownloadRecord, action: "pause" | "resume" | "remove" | "sync") {
    setError("");
    const response = await fetch(`/api/downloads/${download.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.message || t.downloadActionError);
      return;
    }
    await load();
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
    <section className="settings-panel wide">
      <div className="settings-panel-heading">
        <div>
          <h2>{t.downloadTasks}</h2>
          <p>{t.downloadTasksDescription}</p>
        </div>
        <button onClick={syncDownloads} type="button">
          <RefreshCw size={14} />
          {t.sync}
        </button>
      </div>
      <div className="filter-tabs">
        {["ALL", "ACTIVE", "WAITING", "PAUSED", "COMPLETED", "FAILED"].map((status) => (
          <button
            className={filter === status ? "active" : ""}
            key={status}
            onClick={() => setFilter(status)}
            type="button"
          >
            {status}
          </button>
        ))}
      </div>
      {error ? <div className="settings-alert">{error}</div> : null}
      {aria2 ? (
        <div className="download-overview">
          {"error" in aria2 ? (
            <span>{t.aria2StatusError}: {aria2.error}</span>
          ) : (
            <>
              <span>{t.active}: {aria2.numActive}</span>
              <span>{t.waiting}: {aria2.numWaiting}</span>
              <span>{t.stopped}: {aria2.numStopped}</span>
              <span>{t.speed}: {formatBytes(aria2.downloadSpeed)} /s</span>
            </>
          )}
        </div>
      ) : null}
      <div className="download-table enhanced">
        {visibleDownloads.length === 0 ? (
          <p>{t.noDownloads}</p>
        ) : (
          visibleDownloads.map((download) => (
            <article key={download.id}>
              <div>
                <h3>
                  {download.title ||
                    download.candidate?.group?.displayTitle ||
                    download.candidate?.parsedTitle ||
                    t.unknownTitle}
                </h3>
                <p>
                  {formatDownloadLine(download)}
                </p>
                {download.aria2Gid ? <small>gid {download.aria2Gid}</small> : null}
                {download.aria2Files?.length ? (
                  <div className="download-files">
                    {download.aria2Files
                      .filter((file) => file.path && file.path !== "[METADATA]")
                      .slice(0, 3)
                      .map((file) => (
                        <span key={file.path}>
                          {file.path} · {formatBytes(file.completedLength)} /{" "}
                          {formatBytes(file.length)}
                        </span>
                      ))}
                  </div>
                ) : null}
              </div>
              <span>{download.status}</span>
              <strong>{Math.round(download.progress * 100)}%</strong>
              <div className="download-actions">
                <small>{formatBytes(download.downloadSpeed)} /s</small>
                <button
                  aria-label={t.syncTask}
                  onClick={() => void runDownloadAction(download, "sync")}
                  type="button"
                >
                  <RotateCw size={13} />
                </button>
                {download.status === "PAUSED" ? (
                  <button
                    aria-label={t.resumeDownload}
                    onClick={() => void runDownloadAction(download, "resume")}
                    type="button"
                  >
                    <Play size={13} />
                  </button>
                ) : ["ACTIVE", "WAITING"].includes(download.status) ? (
                  <button
                    aria-label={t.pauseDownload}
                    onClick={() => void runDownloadAction(download, "pause")}
                    type="button"
                  >
                    <Pause size={13} />
                  </button>
                ) : null}
                {!["COMPLETED"].includes(download.status) ? (
                  <button
                    aria-label={t.removeDownload}
                    onClick={() => void runDownloadAction(download, "remove")}
                    type="button"
                  >
                    <Trash2 size={13} />
                  </button>
                ) : null}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function formatDownloadLine(download: DownloadRecord) {
  const latestPlan = download.organizerPlans?.[0];
  return [
    download.candidate?.mediaType,
    download.archiveStatus,
    latestPlan ? `plan ${latestPlan.status}` : undefined,
    latestPlan?.items?.[0]?.targetPath || download.targetPath,
    download.errorMessage,
  ]
    .filter(Boolean)
    .join(" · ") || download.status;
}

function formatBytes(value?: string | null) {
  const bytes = Number(value ?? 0);
  if (!bytes) {
    return "0 B";
  }
  if (bytes > 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  if (bytes > 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}
