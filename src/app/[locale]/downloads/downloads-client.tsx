"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
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

export function DownloadsClient({ locale }: { locale: Locale }) {
  const t = getMessages(locale);
  const [downloads, setDownloads] = useState<DownloadRecord[]>([]);
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
      const body = (await response.json()) as { downloads: DownloadRecord[] };
      setDownloads(body.downloads);
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
        {["ALL", "ACTIVE", "WAITING", "COMPLETED", "FAILED"].map((status) => (
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
              <small>{formatBytes(download.downloadSpeed)} /s</small>
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
