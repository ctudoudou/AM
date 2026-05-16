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
  etaSeconds?: number | null;
  aria2Files?: Array<{
    path?: string;
    length?: string;
    completedLength?: string;
    selected?: string;
  }> | null;
  targetPath?: string | null;
  errorMessage?: string | null;
  lastSyncedAt?: string | null;
  aria2Diagnostics?: {
    reason:
      | "none"
      | "no_gid"
      | "aria2_error"
      | "metadata"
      | "queued"
      | "no_peers"
      | "no_files"
      | "paused"
      | "organizer_pending";
    speedBytesPerSecond: string;
    completedBytes: string;
    totalBytes: string;
    etaSeconds: number | null;
    visibleFileCount: number;
    metadataOnly: boolean;
    lastSyncedAt: string | null;
  };
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

type Messages = ReturnType<typeof getMessages>;
type DownloadReason = NonNullable<DownloadRecord["aria2Diagnostics"]>["reason"];

export function DownloadsClient({ locale }: { locale: Locale }) {
  const t = getMessages(locale);
  const [downloads, setDownloads] = useState<DownloadRecord[]>([]);
  const [aria2, setAria2] = useState<Aria2Overview | null>(null);
  const [filter, setFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [pendingAction, setPendingAction] = useState("");

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
    setError("");
    setMessage("");
    setSyncing(true);
    try {
      const response = await fetch("/api/jobs/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job: "downloads.syncAria2" }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.message || t.downloadActionError);
      }
      const result = body?.result?.result ?? body?.result;
      setMessage(formatSyncResult(result, t));
      await load();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : t.downloadActionError);
    } finally {
      setSyncing(false);
    }
  }

  async function runDownloadAction(download: DownloadRecord, action: "pause" | "resume" | "remove" | "sync") {
    setError("");
    setMessage("");
    setPendingAction(`${download.id}:${action}`);
    try {
      const response = await fetch(`/api/downloads/${download.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.message || t.downloadActionError);
        return;
      }
      setMessage(formatActionResult(action, body?.status, t));
      await load();
    } finally {
      setPendingAction("");
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
    <section className="settings-panel wide">
      <div className="settings-panel-heading">
        <div>
          <h2>{t.downloadTasks}</h2>
          <p>{t.downloadTasksDescription}</p>
        </div>
        <button disabled={syncing} onClick={syncDownloads} type="button">
          {syncing ? <Loader2 size={14} /> : <RefreshCw size={14} />}
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
      {message ? <div className="settings-status-row">{message}</div> : null}
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
                  {formatDownloadLine(download, t)}
                </p>
                <p>
                  {formatAria2DetailLine(download, t)}
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
              <span title={formatReason(download.aria2Diagnostics?.reason, t)}>
                {download.status}
              </span>
              <strong>{Math.round(download.progress * 100)}%</strong>
              <div className="download-actions">
                <small>{formatBytes(download.aria2Diagnostics?.speedBytesPerSecond ?? download.downloadSpeed)} /s</small>
                <button
                  aria-label={t.syncTask}
                  disabled={pendingAction === `${download.id}:sync`}
                  onClick={() => void runDownloadAction(download, "sync")}
                  type="button"
                >
                  {pendingAction === `${download.id}:sync` ? <Loader2 size={13} /> : <RotateCw size={13} />}
                </button>
                {download.status === "PAUSED" ? (
                  <button
                    aria-label={t.resumeDownload}
                    disabled={pendingAction === `${download.id}:resume`}
                    onClick={() => void runDownloadAction(download, "resume")}
                    type="button"
                  >
                    {pendingAction === `${download.id}:resume` ? <Loader2 size={13} /> : <Play size={13} />}
                  </button>
                ) : ["ACTIVE", "WAITING"].includes(download.status) ? (
                  <button
                    aria-label={t.pauseDownload}
                    disabled={pendingAction === `${download.id}:pause`}
                    onClick={() => void runDownloadAction(download, "pause")}
                    type="button"
                  >
                    {pendingAction === `${download.id}:pause` ? <Loader2 size={13} /> : <Pause size={13} />}
                  </button>
                ) : null}
                {!["COMPLETED"].includes(download.status) ? (
                  <button
                    aria-label={t.removeDownload}
                    disabled={pendingAction === `${download.id}:remove`}
                    onClick={() => void runDownloadAction(download, "remove")}
                    type="button"
                  >
                    {pendingAction === `${download.id}:remove` ? <Loader2 size={13} /> : <Trash2 size={13} />}
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

function formatDownloadLine(download: DownloadRecord, t: Messages) {
  const latestPlan = download.organizerPlans?.[0];
  return [
    download.candidate?.mediaType,
    download.archiveStatus,
    latestPlan ? `plan ${latestPlan.status}` : undefined,
    latestPlan?.items?.[0]?.targetPath || download.targetPath,
    download.errorMessage ? `${t.aria2Error}: ${download.errorMessage}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ") || download.status;
}

function formatAria2DetailLine(download: DownloadRecord, t: Messages) {
  const diagnostics = download.aria2Diagnostics;
  const totalBytes = diagnostics?.totalBytes ?? download.totalBytes;
  const completedBytes = diagnostics?.completedBytes ?? download.completedBytes;
  const reason = formatReason(diagnostics?.reason, t);
  return [
    `${t.aria2Progress}: ${formatBytes(completedBytes)} / ${formatBytes(totalBytes)}`,
    diagnostics?.etaSeconds ? `${t.aria2Eta}: ${formatDuration(diagnostics.etaSeconds)}` : undefined,
    reason ? `${t.aria2WaitingReason}: ${reason}` : undefined,
    diagnostics?.lastSyncedAt
      ? `${t.aria2LastSynced}: ${formatDateTime(diagnostics.lastSyncedAt)}`
      : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatReason(reason: DownloadReason | undefined, t: Messages) {
  switch (reason) {
    case "no_gid":
      return t.aria2NoGid;
    case "aria2_error":
      return t.aria2StatusError;
    case "metadata":
      return t.aria2MetadataWait;
    case "queued":
      return t.aria2Queued;
    case "no_peers":
      return t.aria2NoPeers;
    case "no_files":
      return t.aria2NoFiles;
    case "paused":
      return t.aria2PausedReason;
    case "organizer_pending":
      return t.aria2CompletePendingOrganizer;
    case "none":
    default:
      return "";
  }
}

function formatSyncResult(result: { synced?: number; failed?: number } | null | undefined, t: Messages) {
  if (!result) {
    return t.downloadsSyncDone;
  }
  if (result.failed) {
    return `${t.downloadsSyncFailed}: ${result.failed} · ${t.downloadsSynced}: ${result.synced ?? 0}`;
  }
  return `${t.downloadsSyncDone}: ${result.synced ?? 0}`;
}

function formatActionResult(action: "pause" | "resume" | "remove" | "sync", status: string | undefined, t: Messages) {
  const label = {
    pause: t.pauseDownload,
    resume: t.resumeDownload,
    remove: t.removeDownload,
    sync: t.syncTask,
  }[action];
  return status ? `${label}: ${status}` : t.downloadActionDone;
}

function formatDuration(seconds: number) {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  if (seconds < 3600) {
    return `${Math.ceil(seconds / 60)}m`;
  }
  return `${Math.ceil(seconds / 3600)}h`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
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
