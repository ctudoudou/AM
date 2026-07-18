"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pause, Play, RefreshCw, RotateCw, ScanSearch, Trash2 } from "lucide-react";
import { getMessages } from "@/messages";
import { buildDownloadPipeline, type PipelineStageState } from "@/lib/download-pipeline";
import type { Locale } from "@/lib/i18n";
import { VideoSourceImportPanel } from "./video-source-import";

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
    lastProgressAt: string | null;
    stalledSince: string | null;
    stalledForSeconds: number;
    stallState: "none" | "cooling" | "needs_source" | "blocked";
    peerCount: number | null;
    seederCount: number | null;
    retryCount: number;
    nextRetryAt: string | null;
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
type DownloadAction = "pause" | "resume" | "remove" | "sync" | "retry";
type DownloadFilter = "ALL" | "ACTIVE" | "WAITING" | "PAUSED" | "COMPLETED" | "FAILED";
type DownloadPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
};

type DownloadReconciliationPlan = {
  planId: string;
  warnings: string[];
  summary: {
    knownAria2: number;
    untrackedAria2: number;
    anomalies: number;
    archivedActive: number;
    safePause: number;
    manualReview: number;
  };
  items: Array<{
    actionId: string;
    kind:
      | "archived_active"
      | "archived_result"
      | "untracked_payload"
      | "untracked_metadata"
      | "untracked_error"
      | "ambiguous_match";
    gid: string;
    aria2Status: string;
    title: string | null;
    downloadId: string | null;
    recommendedAction: "pause" | "keep_paused" | "remove_result" | "review";
    safeToPause: boolean;
    completedBytes: string;
    totalBytes: string;
    libraryTargets: Array<{ state: string }>;
  }>;
};

type DownloadOperationRecord = {
  id: string;
  action: string;
  status: string;
  entityId: string | null;
  externalId: string | null;
  errorMessage: string | null;
  createdAt: string;
};

const downloadReconciliationConfirmation =
  "I understand this pauses verified archived aria2 tasks";

const downloadFilters: DownloadFilter[] = [
  "ALL",
  "ACTIVE",
  "WAITING",
  "PAUSED",
  "COMPLETED",
  "FAILED",
];
const defaultPagination: DownloadPagination = {
  page: 1,
  pageSize: 25,
  total: 0,
  totalPages: 1,
  hasNext: false,
  hasPrevious: false,
};

export function DownloadsClient({ locale }: { locale: Locale }) {
  const t = getMessages(locale);
  const [downloads, setDownloads] = useState<DownloadRecord[]>([]);
  const [aria2, setAria2] = useState<Aria2Overview | null>(null);
  const [filter, setFilter] = useState<DownloadFilter>("ALL");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<DownloadPagination>(defaultPagination);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [reconciliation, setReconciliation] = useState<DownloadReconciliationPlan | null>(null);
  const [selectedReconciliationActions, setSelectedReconciliationActions] = useState<string[]>([]);
  const [reconciliationConfirmation, setReconciliationConfirmation] = useState("");
  const [applyingReconciliation, setApplyingReconciliation] = useState(false);
  const [downloadOperations, setDownloadOperations] = useState<DownloadOperationRecord[]>([]);
  const [pendingAction, setPendingAction] = useState("");

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "25" });
      if (filter !== "ALL") {
        params.set("status", filter);
      }
      const response = await fetch(`/api/downloads?${params.toString()}`);
      if (!response.ok) {
        throw new Error(t.downloadsLoadError);
      }
      const body = (await response.json()) as {
        downloads: DownloadRecord[];
        aria2?: Aria2Overview;
        pagination: DownloadPagination;
      };
      setDownloads(body.downloads);
      setAria2(body.aria2 ?? null);
      setPagination(body.pagination);
      if (body.pagination.total > 0 && page > body.pagination.totalPages) {
        setPage(body.pagination.totalPages);
      }
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t.downloadsLoadError);
    } finally {
      setLoading(false);
    }
  }, [filter, page, t.downloadsLoadError]);

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

  async function reconcileDownloads() {
    setError("");
    setMessage("");
    setReconciling(true);
    try {
      const [response, operationsResponse] = await Promise.all([
        fetch("/api/downloads/reconciliation"),
        fetch("/api/operations?domain=DOWNLOAD&limit=10"),
      ]);
      const [body, operationsBody] = await Promise.all([
        response.json().catch(() => null),
        operationsResponse.json().catch(() => null),
      ]);
      if (!response.ok) {
        throw new Error(body?.message || t.downloadReconciliationLoadError);
      }
      setReconciliation(body as DownloadReconciliationPlan);
      setDownloadOperations(
        operationsResponse.ok && Array.isArray(operationsBody?.operations)
          ? operationsBody.operations
          : [],
      );
      setSelectedReconciliationActions([]);
      setReconciliationConfirmation("");
    } catch (reconciliationError) {
      setError(
        reconciliationError instanceof Error
          ? reconciliationError.message
          : t.downloadReconciliationLoadError,
      );
    } finally {
      setReconciling(false);
    }
  }

  async function applyReconciliation() {
    if (!reconciliation || selectedReconciliationActions.length === 0) {
      return;
    }
    setError("");
    setMessage("");
    setApplyingReconciliation(true);
    try {
      const response = await fetch("/api/downloads/reconciliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: reconciliation.planId,
          actionIds: selectedReconciliationActions,
          confirmation: reconciliationConfirmation,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.message || t.downloadReconciliationApplyError);
      }
      await reconcileDownloads();
      setMessage(
        `${t.downloadReconciliationPaused}: ${body?.succeeded ?? 0} · ${t.downloadReconciliationFailed}: ${body?.failed ?? 0}`,
      );
      await load();
    } catch (applyError) {
      setError(
        applyError instanceof Error ? applyError.message : t.downloadReconciliationApplyError,
      );
    } finally {
      setApplyingReconciliation(false);
    }
  }

  async function runDownloadAction(download: DownloadRecord, action: DownloadAction) {
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
        <div className="download-heading-actions">
          <button disabled={reconciling} onClick={reconcileDownloads} type="button">
            {reconciling ? <Loader2 size={14} /> : <ScanSearch size={14} />}
            {t.downloadReconciliation}
          </button>
          <button disabled={syncing} onClick={syncDownloads} type="button">
            {syncing ? <Loader2 size={14} /> : <RefreshCw size={14} />}
            {t.sync}
          </button>
        </div>
      </div>
      <VideoSourceImportPanel
        locale={locale}
        onQueued={() => {
          setFilter("ALL");
          setPage(1);
          void load();
        }}
      />
      <div className="filter-tabs">
        {downloadFilters.map((status) => (
          <button
            aria-pressed={filter === status}
            className={filter === status ? "active" : ""}
            key={status}
            onClick={() => {
              setFilter(status);
              setPage(1);
            }}
            type="button"
          >
            {downloadStatusLabel(status, t)}
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
      {reconciliation ? (
        <DownloadReconciliation
          applying={applyingReconciliation}
          confirmation={reconciliationConfirmation}
          onApply={() => void applyReconciliation()}
          onConfirmationChange={setReconciliationConfirmation}
          onSelectionChange={setSelectedReconciliationActions}
          operations={downloadOperations}
          plan={reconciliation}
          selectedActionIds={selectedReconciliationActions}
          t={t}
        />
      ) : null}
      <div className="download-table enhanced">
        {downloads.length === 0 ? (
          <p>{t.noDownloads}</p>
        ) : (
          downloads.map((download) => (
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
                <DownloadPipelineStatus download={download} t={t} />
                {download.aria2Gid ? <small>gid {download.aria2Gid}</small> : null}
                {download.aria2Files?.length ? (
                  <div className="download-files">
                    {download.aria2Files
                      .filter((file) => file.path && !file.path.startsWith("[METADATA]"))
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
                {downloadStatusLabel(download.status, t)}
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
                {download.status === "FAILED" ? (
                  <button
                    aria-label={t.retryDownload}
                    disabled={pendingAction === `${download.id}:retry`}
                    onClick={() => void runDownloadAction(download, "retry")}
                    type="button"
                  >
                    {pendingAction === `${download.id}:retry` ? <Loader2 size={13} /> : <RefreshCw size={13} />}
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
      {pagination.total > pagination.pageSize ? (
        <div className="candidate-pagination download-pagination">
          <span>
            {t.queueShowing} {paginationStart(pagination)}–{paginationEnd(pagination)} / {pagination.total}
          </span>
          <div>
            <button
              disabled={!pagination.hasPrevious}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              type="button"
            >
              {t.queuePrevious}
            </button>
            <button
              disabled={!pagination.hasNext}
              onClick={() => setPage((current) => current + 1)}
              type="button"
            >
              {t.queueNext}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function DownloadReconciliation({
  applying,
  confirmation,
  onApply,
  onConfirmationChange,
  onSelectionChange,
  operations,
  plan,
  selectedActionIds,
  t,
}: {
  applying: boolean;
  confirmation: string;
  onApply: () => void;
  onConfirmationChange: (value: string) => void;
  onSelectionChange: (value: string[]) => void;
  operations: DownloadOperationRecord[];
  plan: DownloadReconciliationPlan;
  selectedActionIds: string[];
  t: Messages;
}) {
  const selected = new Set(selectedActionIds);
  const selectableItems = plan.items.filter(
    (item) => item.safeToPause && item.recommendedAction === "pause",
  );
  return (
    <section aria-live="polite" className="download-reconciliation">
      <div className="download-reconciliation-heading">
        <div>
          <strong>{t.downloadReconciliation}</strong>
          <span>{t.downloadReconciliationDescription}</span>
        </div>
        <small>{t.downloadReconciliationReadOnly}</small>
      </div>
      <div className="download-reconciliation-summary">
        <span>{t.downloadReconciliationKnown}: <strong>{plan.summary.knownAria2}</strong></span>
        <span>{t.downloadReconciliationUntracked}: <strong>{plan.summary.untrackedAria2}</strong></span>
        <span>{t.downloadReconciliationAnomalies}: <strong>{plan.summary.anomalies}</strong></span>
        <span>{t.downloadReconciliationArchivedActive}: <strong>{plan.summary.archivedActive}</strong></span>
        <span>{t.downloadReconciliationSafePause}: <strong>{plan.summary.safePause}</strong></span>
        <span>{t.downloadReconciliationManualReview}: <strong>{plan.summary.manualReview}</strong></span>
      </div>
      {plan.warnings.map((warning) => (
        <div className="settings-alert" key={warning}>{warning}</div>
      ))}
      {plan.items.length === 0 ? (
        <p>{t.downloadReconciliationEmpty}</p>
      ) : (
        <div className="download-reconciliation-list">
          {plan.items.slice(0, 20).map((item) => (
            <article key={item.actionId}>
              <div>
                <strong>{item.title || t.unknownTitle}</strong>
                <span>
                  gid {item.gid} · {item.aria2Status} · {formatBytes(item.completedBytes)} / {formatBytes(item.totalBytes)}
                </span>
              </div>
              <span>{downloadReconciliationKindLabel(item.kind, t)}</span>
              {item.safeToPause && item.recommendedAction === "pause" ? (
                <label className="download-reconciliation-select">
                  <input
                    checked={selected.has(item.actionId)}
                    onChange={(event) => {
                      onSelectionChange(
                        event.target.checked
                          ? [...selectedActionIds, item.actionId]
                          : selectedActionIds.filter((actionId) => actionId !== item.actionId),
                      );
                    }}
                    type="checkbox"
                  />
                  {t.downloadReconciliationSafePauseCandidate}
                </label>
              ) : (
                <em className="review">{t.downloadReconciliationReviewRequired}</em>
              )}
            </article>
          ))}
          {plan.items.length > 20 ? (
            <small className="download-reconciliation-more">
              {t.queueShowing} 1–20 / {plan.items.length}
            </small>
          ) : null}
        </div>
      )}
      {selectableItems.length > 0 ? (
        <div className="download-reconciliation-execution">
          <label>
            <span>{t.downloadReconciliationConfirmation}</span>
            <code>{downloadReconciliationConfirmation}</code>
            <input
              onChange={(event) => onConfirmationChange(event.target.value)}
              placeholder={t.downloadReconciliationConfirmationPlaceholder}
              type="text"
              value={confirmation}
            />
          </label>
          <button
            disabled={
              applying ||
              selectedActionIds.length === 0 ||
              confirmation !== downloadReconciliationConfirmation
            }
            onClick={onApply}
            type="button"
          >
            {applying ? <Loader2 size={14} /> : <Pause size={14} />}
            {t.downloadReconciliationPauseSelected} ({selectedActionIds.length})
          </button>
        </div>
      ) : null}
      {operations.length > 0 ? (
        <details className="download-operation-log">
          <summary>{t.downloadOperationLog}</summary>
          <div>
            {operations.map((operation) => (
              <article key={operation.id}>
                <span>{downloadOperationActionLabel(operation.action, t)}</span>
                <strong>{downloadOperationStatusLabel(operation.status, t)}</strong>
                <small>
                  {operation.externalId ? `gid ${operation.externalId} · ` : ""}
                  {formatDateTime(operation.createdAt)}
                  {operation.errorMessage ? ` · ${operation.errorMessage}` : ""}
                </small>
              </article>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function downloadOperationActionLabel(action: string, t: Messages) {
  return {
    PAUSE_ARCHIVED_REDOWNLOAD: t.downloadOperationPauseArchived,
    ROLLBACK_PAUSE_ARCHIVED_REDOWNLOAD: t.downloadOperationResumeArchived,
  }[action] ?? action;
}

function downloadOperationStatusLabel(status: string, t: Messages) {
  return {
    STARTED: t.downloadOperationStarted,
    SUCCEEDED: t.downloadOperationSucceeded,
    FAILED: t.downloadOperationFailed,
    ROLLED_BACK: t.downloadOperationRolledBack,
  }[status] ?? status;
}

function downloadReconciliationKindLabel(
  kind: DownloadReconciliationPlan["items"][number]["kind"],
  t: Messages,
) {
  return {
    archived_active: t.downloadReconciliationKindArchivedActive,
    archived_result: t.downloadReconciliationKindArchivedResult,
    untracked_payload: t.downloadReconciliationKindUntrackedPayload,
    untracked_metadata: t.downloadReconciliationKindUntrackedMetadata,
    untracked_error: t.downloadReconciliationKindUntrackedError,
    ambiguous_match: t.downloadReconciliationKindAmbiguousMatch,
  }[kind];
}

function DownloadPipelineStatus({ download, t }: { download: DownloadRecord; t: Messages }) {
  const pipeline = buildDownloadPipeline(download);
  const stages = [
    { label: t.pipelineDownload, state: pipeline.download },
    { label: t.pipelineOrganizer, state: pipeline.organizer },
    { label: t.pipelineLibrary, state: pipeline.library },
  ];
  return (
    <div className="download-pipeline" title={pipeline.blockedReason ?? undefined}>
      {stages.map((stage, index) => (
        <span className={`download-pipeline-stage ${stage.state}`} key={stage.label}>
          <i aria-hidden="true" />
          {stage.label}
          <small>{pipelineStateLabel(stage.state, t)}</small>
          {index < stages.length - 1 ? <b aria-hidden="true">→</b> : null}
        </span>
      ))}
      {pipeline.blockedReason ? (
        <em>{pipeline.blockedReason === "download_failed" ? t.pipelineDownloadFailed : pipeline.blockedReason}</em>
      ) : null}
    </div>
  );
}

function pipelineStateLabel(state: PipelineStageState, t: Messages) {
  return {
    waiting: t.pipelineWaiting,
    active: t.pipelineActive,
    done: t.pipelineDone,
    blocked: t.pipelineBlocked,
  }[state];
}

function formatDownloadLine(download: DownloadRecord, t: Messages) {
  const latestPlan = download.organizerPlans?.[0];
  return [
    formatDownloadMediaType(download.candidate?.mediaType, t),
    download.archiveStatus === "archived"
      ? `${t.pipelineLibrary}: ${t.pipelineDone}`
      : download.archiveStatus === "organizer_failed"
        ? `${t.pipelineOrganizer}: ${t.pipelineBlocked}`
        : download.archiveStatus || undefined,
    latestPlan ? `${t.pipelineOrganizer}: ${organizerPlanStatusLabel(latestPlan.status, t)}` : undefined,
    latestPlan?.items?.[0]?.targetPath || download.targetPath,
    download.errorMessage ? `${t.aria2Error}: ${download.errorMessage}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ") || download.status;
}

function formatDownloadMediaType(mediaType: "ANIME" | "MOVIE" | "TV" | undefined, t: Messages) {
  if (mediaType === "ANIME") return t.anime;
  if (mediaType === "MOVIE") return t.movies;
  if (mediaType === "TV") return t.tv;
  return undefined;
}

function organizerPlanStatusLabel(status: string, t: Messages) {
  return {
    PENDING: t.organizerStatusPending,
    NEEDS_REVIEW: t.organizerStatusNeedsReview,
    CONFLICT: t.organizerStatusConflict,
    FAILED: t.organizerStatusFailed,
    EXECUTED: t.organizerStatusExecuted,
    REJECTED: t.organizerStatusRejected,
    AUTO_ARCHIVED: t.organizerStatusAutoArchived,
  }[status] ?? status;
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
    diagnostics?.peerCount !== null && diagnostics?.peerCount !== undefined
      ? `${t.aria2Peers}: ${diagnostics.peerCount}`
      : undefined,
    diagnostics?.seederCount !== null && diagnostics?.seederCount !== undefined
      ? `${t.aria2Seeders}: ${diagnostics.seederCount}`
      : undefined,
    diagnostics?.stallState && diagnostics.stallState !== "none"
      ? `${downloadStallStateLabel(diagnostics.stallState, t)} · ${formatDuration(diagnostics.stalledForSeconds)}`
      : undefined,
    diagnostics?.retryCount ? `${t.aria2Retries}: ${diagnostics.retryCount}` : undefined,
    diagnostics?.nextRetryAt
      ? `${t.aria2NextRetry}: ${formatDateTime(diagnostics.nextRetryAt)}`
      : undefined,
    diagnostics?.lastSyncedAt
      ? `${t.aria2LastSynced}: ${formatDateTime(diagnostics.lastSyncedAt)}`
      : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

function downloadStallStateLabel(
  state: "cooling" | "needs_source" | "blocked",
  t: Messages,
) {
  return {
    cooling: t.aria2StallCooling,
    needs_source: t.aria2StallNeedsSource,
    blocked: t.aria2StallBlocked,
  }[state];
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

function formatActionResult(action: DownloadAction, status: string | undefined, t: Messages) {
  const label = {
    pause: t.pauseDownload,
    resume: t.resumeDownload,
    remove: t.removeDownload,
    sync: t.syncTask,
    retry: t.retryDownload,
  }[action];
  return status ? `${label}: ${downloadStatusLabel(status, t)}` : t.downloadActionDone;
}

function downloadStatusLabel(status: string, t: Messages) {
  return {
    ALL: t.downloadStatusAll,
    ACTIVE: t.downloadStatusActive,
    WAITING: t.downloadStatusWaiting,
    PAUSED: t.downloadStatusPaused,
    COMPLETED: t.downloadStatusCompleted,
    FAILED: t.downloadStatusFailed,
  }[status] ?? status;
}

function paginationStart(pagination: DownloadPagination) {
  return (pagination.page - 1) * pagination.pageSize + 1;
}

function paginationEnd(pagination: DownloadPagination) {
  return Math.min(pagination.page * pagination.pageSize, pagination.total);
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
