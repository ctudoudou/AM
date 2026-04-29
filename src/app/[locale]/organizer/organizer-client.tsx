"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, FolderSearch, Loader2, RefreshCw, X } from "lucide-react";
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

export function OrganizerClient({ locale }: { locale: Locale }) {
  const t = getMessages(locale);
  const [plans, setPlans] = useState<OrganizerPlan[]>([]);
  const [filter, setFilter] = useState("ALL");
  const [importDraft, setImportDraft] = useState({ root: "", mediaType: "AUTO" });
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const visiblePlans = useMemo(
    () => plans.filter((plan) => filter === "ALL" || plan.status === filter),
    [filter, plans],
  );

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/organizer/plans");
      if (!response.ok) {
        throw new Error(t.organizerLoadError);
      }
      const body = (await response.json()) as { plans: OrganizerPlan[] };
      setPlans(body.plans);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t.organizerLoadError);
    } finally {
      setLoading(false);
    }
  }, [t.organizerLoadError]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

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
        <button onClick={runInspect} type="button">
          <RefreshCw size={14} />
          {t.inspectCompleted}
        </button>
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
        {["ALL", "PENDING", "NEEDS_REVIEW", "CONFLICT", "FAILED", "REJECTED", "EXECUTED"].map((status) => (
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
      {status ? <div className="settings-success">{status}</div> : null}
      <div className="organizer-list">
        {visiblePlans.length === 0 ? (
          <p>{t.noOrganizerPlans}</p>
        ) : (
          visiblePlans.map((plan) => {
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
