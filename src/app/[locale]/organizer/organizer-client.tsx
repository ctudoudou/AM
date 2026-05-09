"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  CheckCheck,
  FolderSearch,
  Loader2,
  RefreshCw,
  ShieldCheck,
  WandSparkles,
  X,
} from "lucide-react";
import { getMessages } from "@/messages";
import type { Locale } from "@/lib/i18n";

type OrganizerPlan = {
  id: string;
  mediaType: "ANIME" | "MOVIE" | "TV";
  status: string;
  confidence: number;
  reason?: string | null;
  autoExecutable: boolean;
  candidate?: {
    parsedTitle: string;
    group?: { displayTitle: string } | null;
  } | null;
  items: Array<{
    id: string;
    sourcePath: string;
    targetPath: string;
    conflict: boolean;
    conflictReason?: string | null;
  }>;
  metadata?: {
    title?: string;
    posterUrl?: string;
    year?: number;
  } | null;
};

type OrganizerSettings = {
  directories: {
    importRoot: string;
  };
};

const organizerFilters = [
  "ACTIVE",
  "AUTO_READY",
  "PENDING",
  "NEEDS_REVIEW",
  "CONFLICT",
  "FAILED",
  "HISTORY",
  "EXECUTED",
  "REJECTED",
  "AUTO_ARCHIVED",
  "ALL",
] as const;

type OrganizerFilter = (typeof organizerFilters)[number];

type OrganizerStats = {
  active: number;
  autoExecutable: number;
  all: number;
  byStatus: Record<string, number | undefined>;
};

export function OrganizerClient({ locale }: { locale: Locale }) {
  const t = getMessages(locale);
  const [plans, setPlans] = useState<OrganizerPlan[]>([]);
  const [stats, setStats] = useState<OrganizerStats | null>(null);
  const [filter, setFilter] = useState<OrganizerFilter>("ACTIVE");
  const [importDraft, setImportDraft] = useState({ root: "", mediaType: "AUTO" });
  const [importing, setImporting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [autoExecuting, setAutoExecuting] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/organizer/plans?${organizerPlanParams(filter)}`);
      if (!response.ok) {
        throw new Error(t.organizerLoadError);
      }
      const body = (await response.json()) as { plans: OrganizerPlan[]; stats?: OrganizerStats };
      setPlans(body.plans);
      setStats(body.stats ?? null);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t.organizerLoadError);
    } finally {
      setLoading(false);
    }
  }, [filter, t.organizerLoadError]);

  const loadImportRoot = useCallback(async () => {
    const response = await fetch("/api/settings");
    if (!response.ok) {
      return;
    }
    const body = (await response.json()) as OrganizerSettings;
    setImportDraft((current) => ({
      ...current,
      root: current.root.trim() ? current.root : body.directories.importRoot,
    }));
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadImportRoot();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadImportRoot]);

  async function runInspect() {
    setStatus("");
    const response = await fetch("/api/jobs/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job: "organizer.inspectCompletedDownloads" }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.message || t.organizerLoadError);
      return;
    }
    await load();
  }

  async function runAiReview() {
    setReviewing(true);
    setStatus("");
    setError("");
    const response = await fetch("/api/jobs/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job: "organizer.aiReviewPlans" }),
    });
    setReviewing(false);
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.message || t.aiReviewPlansError);
      return;
    }
    const body = (await response.json()) as {
      result?: { reviewed?: number; filteredItems?: number; flagged?: number; skipped?: number };
    };
    setStatus(
      `${t.aiReviewPlansDone} reviewed: ${body.result?.reviewed ?? 0}, filtered: ${body.result?.filteredItems ?? 0}, flagged: ${body.result?.flagged ?? 0}, skipped: ${body.result?.skipped ?? 0}.`,
    );
    await load();
  }

  async function runAutoExecute() {
    setAutoExecuting(true);
    setStatus("");
    setError("");
    const response = await fetch("/api/jobs/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job: "organizer.autoExecuteReadyPlans" }),
    });
    setAutoExecuting(false);
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.message || t.autoExecuteOrganizerPlansError);
      return;
    }
    const body = (await response.json()) as {
      result?: { inspected?: number; executed?: number; skipped?: number; failed?: number };
    };
    setStatus(
      `${t.autoExecuteOrganizerPlansDone} inspected: ${body.result?.inspected ?? 0}, executed: ${body.result?.executed ?? 0}, skipped: ${body.result?.skipped ?? 0}, failed: ${body.result?.failed ?? 0}.`,
    );
    await load();
  }

  async function runRepairPipeline() {
    setRepairing(true);
    setStatus("");
    setError("");
    const jobs = [
      "organizer.cleanupPollutedPlans",
      "organizer.cleanupStalePlans",
      "downloads.syncAria2",
      "organizer.inspectCompletedDownloads",
      "organizer.aiReviewPlans",
      "library.mergeDuplicateAnimeTitles",
    ];
    const results: Array<{ job: string; result: Record<string, unknown> }> = [];

    for (const job of jobs) {
      const response = await fetch("/api/jobs/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setRepairing(false);
        setError(body?.message || t.repairOrganizerPipelineError);
        return;
      }
      const body = (await response.json()) as { result?: Record<string, unknown> };
      results.push({ job, result: body.result ?? {} });
    }

    setRepairing(false);
    setStatus(formatRepairSummary(t, results));
    await load();
  }

  async function runImportScan() {
    setImporting(true);
    setError("");
    setStatus("");
    const response = await fetch("/api/organizer/import-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(importDraft),
    });
    setImporting(false);
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.message || t.importScanError);
      return;
    }
    const body = (await response.json()) as { planned: number; skipped: number; lowConfidence: number };
    setStatus(
      `${t.importScanCreated} ${t.importScanPlanned}: ${body.planned}, ${t.importScanSkipped}: ${body.skipped}, ${t.importScanReview}: ${body.lowConfidence}.`,
    );
    await load();
  }

  async function execute(plan: OrganizerPlan) {
    if (!canExecutePlan(plan)) {
      setError(t.organizerExecuteError);
      return;
    }
    const response = await fetch(`/api/organizer/plans/${plan.id}/execute`, {
      method: "POST",
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.message || t.organizerExecuteError);
      return;
    }
    await load();
  }

  async function reject(plan: OrganizerPlan) {
    const response = await fetch(`/api/organizer/plans/${plan.id}/reject`, {
      method: "POST",
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.message || t.organizerRejectError);
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
          <h2>{t.organizerPlans}</h2>
          <p>{t.organizerPlansDescription}</p>
        </div>
        <div className="toolbar-actions">
          <button disabled={repairing} onClick={() => void runRepairPipeline()} type="button">
            {repairing ? <Loader2 size={14} /> : <ShieldCheck size={14} />}
            {t.repairOrganizerPipeline}
          </button>
          <button
            disabled={autoExecuting || (stats ? stats.autoExecutable === 0 : false)}
            onClick={() => void runAutoExecute()}
            type="button"
          >
            {autoExecuting ? <Loader2 size={14} /> : <CheckCheck size={14} />}
            {t.autoExecuteOrganizerPlans}
          </button>
          <button disabled={reviewing} onClick={() => void runAiReview()} type="button">
            {reviewing ? <Loader2 size={14} /> : <WandSparkles size={14} />}
            {t.aiReviewPlans}
          </button>
          <button onClick={runInspect} type="button">
            <RefreshCw size={14} />
            {t.inspectCompleted}
          </button>
        </div>
      </div>
      <div className="organizer-import-panel">
        <div>
          <strong>{t.importScan}</strong>
          <span>{t.importScanDescription}</span>
        </div>
        <input
          onChange={(event) => setImportDraft({ ...importDraft, root: event.target.value })}
          placeholder={t.importRoot}
          value={importDraft.root}
        />
        <select
          onChange={(event) => setImportDraft({ ...importDraft, mediaType: event.target.value })}
          value={importDraft.mediaType}
        >
          <option value="AUTO">{t.autoDetect}</option>
          <option value="ANIME">{t.anime}</option>
          <option value="MOVIE">{t.movies}</option>
          <option value="TV">{t.tv}</option>
        </select>
        <button disabled={importing || !importDraft.root.trim()} onClick={() => void runImportScan()} type="button">
          {importing ? <Loader2 size={14} /> : <FolderSearch size={14} />}
          {t.importScan}
        </button>
      </div>
      <div className="filter-tabs">
        {organizerFilters.map((status) => (
          <button
            className={filter === status ? "active" : ""}
            key={status}
            onClick={() => setFilter(status)}
            type="button"
          >
            <span>{formatOrganizerFilter(status, t)}</span>
            <small>{countForOrganizerFilter(status, stats)}</small>
          </button>
        ))}
      </div>
      {error ? <div className="settings-alert">{error}</div> : null}
      {status ? <div className="settings-success">{status}</div> : null}
      <div className="organizer-list">
        {plans.length === 0 ? (
          <p>{t.noOrganizerPlans}</p>
        ) : (
          plans.map((plan) => {
            const executable = canExecutePlan(plan);
            const rejectable = canRejectPlan(plan);
            const title =
              plan.metadata?.title ||
              plan.candidate?.group?.displayTitle ||
              plan.candidate?.parsedTitle ||
              t.unknownTitle;
            return (
              <article key={plan.id}>
                <div className="organizer-plan-heading">
                  <div className="organizer-plan-media">
                    {plan.metadata?.posterUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="organizer-poster" src={plan.metadata.posterUrl} alt="" />
                    ) : (
                      <span className="organizer-poster-fallback">{getTitleInitial(title)}</span>
                    )}
                    <div className="organizer-plan-title">
                      <h2>{title}</h2>
                      {plan.metadata?.year ? <span>{plan.metadata.year}</span> : null}
                      <p>
                        {formatMediaType(plan.mediaType, t)} · {plan.status} ·{" "}
                        {Math.round(plan.confidence * 100)}% · {plan.reason || "-"}
                      </p>
                    </div>
                  </div>
                  <div className="toolbar-actions">
                    <button
                      disabled={!executable}
                      onClick={() => void execute(plan)}
                      type="button"
                    >
                      <Check size={14} />
                      {t.execute}
                    </button>
                    <button
                      disabled={!rejectable}
                      onClick={() => void reject(plan)}
                      type="button"
                    >
                      <X size={14} />
                      {t.reject}
                    </button>
                  </div>
                </div>
                <div className="organizer-paths">
                  {plan.items.map((item) => (
                    <div key={item.id}>
                      <span>{item.sourcePath}</span>
                      <strong>{item.targetPath}</strong>
                      {item.conflict ? <em>{item.conflictReason || t.conflict}</em> : null}
                    </div>
                  ))}
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

function getTitleInitial(title: string) {
  return title.trim().slice(0, 1).toUpperCase() || "?";
}

function canExecutePlan(plan: OrganizerPlan) {
  return (
    ["PENDING", "NEEDS_REVIEW"].includes(plan.status) &&
    plan.items.length > 0 &&
    plan.items.every((item) => !item.conflict)
  );
}

function canRejectPlan(plan: OrganizerPlan) {
  return !["AUTO_ARCHIVED", "EXECUTED", "REJECTED"].includes(plan.status);
}

function organizerPlanParams(filter: OrganizerFilter) {
  const params = new URLSearchParams();
  if (filter === "ACTIVE") {
    params.set("view", "active");
  } else if (filter === "AUTO_READY") {
    params.set("view", "auto");
  } else if (filter === "HISTORY") {
    params.set("view", "history");
  } else if (filter === "ALL") {
    params.set("view", "all");
    params.set("limit", "300");
  } else {
    params.set("status", filter);
    params.set("limit", ["EXECUTED", "REJECTED", "AUTO_ARCHIVED"].includes(filter) ? "100" : "200");
  }
  return params.toString();
}

function formatOrganizerFilter(filter: OrganizerFilter, t: ReturnType<typeof getMessages>) {
  if (filter === "ACTIVE") {
    return t.activeOrganizerPlans;
  }
  if (filter === "AUTO_READY") {
    return t.autoExecutableOrganizerPlans;
  }
  if (filter === "HISTORY") {
    return t.organizerHistory;
  }
  if (filter === "ALL") {
    return t.allOrganizerPlans;
  }
  if (filter === "PENDING") {
    return t.organizerStatusPending;
  }
  if (filter === "NEEDS_REVIEW") {
    return t.organizerStatusNeedsReview;
  }
  if (filter === "CONFLICT") {
    return t.organizerStatusConflict;
  }
  if (filter === "FAILED") {
    return t.organizerStatusFailed;
  }
  if (filter === "EXECUTED") {
    return t.organizerStatusExecuted;
  }
  if (filter === "REJECTED") {
    return t.organizerStatusRejected;
  }
  return t.organizerStatusAutoArchived;
}

function countForOrganizerFilter(filter: OrganizerFilter, stats: OrganizerStats | null) {
  if (!stats) {
    return "-";
  }
  if (filter === "ACTIVE") {
    return String(stats.active);
  }
  if (filter === "AUTO_READY") {
    return String(stats.autoExecutable);
  }
  if (filter === "HISTORY") {
    return String(
      (stats.byStatus.EXECUTED ?? 0) +
        (stats.byStatus.AUTO_ARCHIVED ?? 0) +
        (stats.byStatus.REJECTED ?? 0),
    );
  }
  if (filter === "ALL") {
    return String(stats.all);
  }
  return String(stats.byStatus[filter] ?? 0);
}

function formatMediaType(
  value: OrganizerPlan["mediaType"],
  t: ReturnType<typeof getMessages>,
) {
  if (value === "ANIME") {
    return t.anime;
  }
  if (value === "MOVIE") {
    return t.movies;
  }
  return t.tv;
}

function formatRepairSummary(
  t: ReturnType<typeof getMessages>,
  results: Array<{ job: string; result: Record<string, unknown> }>,
) {
  const byJob = new Map(results.map((item) => [item.job, item.result]));
  const cleanup = byJob.get("organizer.cleanupPollutedPlans");
  const stale = byJob.get("organizer.cleanupStalePlans");
  const sync = byJob.get("downloads.syncAria2");
  const inspect = byJob.get("organizer.inspectCompletedDownloads");
  const review = byJob.get("organizer.aiReviewPlans");
  const merge = byJob.get("library.mergeDuplicateAnimeTitles");
  return [
    t.repairOrganizerPipelineDone,
    `deleted: ${numberValue(cleanup?.deleted)}`,
    `stale rejected: ${numberValue(stale?.rejected)}`,
    `synced: ${numberValue(sync?.synced)}`,
    `plans: ${numberValue(inspect?.inspected)}`,
    `ai reviewed: ${numberValue(review?.reviewed)}`,
    `filtered: ${numberValue(review?.filteredItems)}`,
    `merged titles: ${numberValue(merge?.merged)}`,
  ].join(" ");
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : 0;
}
