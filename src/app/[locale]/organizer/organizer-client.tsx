"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Loader2, RefreshCw, X } from "lucide-react";
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
    await fetch("/api/jobs/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job: "organizer.inspectCompletedDownloads" }),
    });
    await load();
  }

  async function execute(plan: OrganizerPlan) {
    const response = await fetch(`/api/organizer/plans/${plan.id}/execute`, {
      method: "POST",
    });
    if (!response.ok) {
      setError(t.organizerExecuteError);
      return;
    }
    await load();
  }

  async function reject(plan: OrganizerPlan) {
    const response = await fetch(`/api/organizer/plans/${plan.id}/reject`, {
      method: "POST",
    });
    if (!response.ok) {
      setError(t.organizerRejectError);
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
      <div className="organizer-list">
        {visiblePlans.length === 0 ? (
          <p>{t.noOrganizerPlans}</p>
        ) : (
          visiblePlans.map((plan) => (
            <article key={plan.id}>
              <div className="candidate-heading">
                {plan.metadata?.posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="organizer-poster" src={plan.metadata.posterUrl} alt="" />
                ) : null}
                <div>
                  <h2>
                    {plan.metadata?.title ||
                      plan.candidate?.group?.displayTitle ||
                      plan.candidate?.parsedTitle ||
                      t.unknownTitle}
                  </h2>
                  <p>
                    {formatMediaType(plan.mediaType, t)} · {plan.status} ·{" "}
                    {Math.round(plan.confidence * 100)}% ·{" "}
                    {plan.reason || "-"}
                  </p>
                </div>
                <div className="toolbar-actions">
                  <button onClick={() => void execute(plan)} type="button">
                    <Check size={14} />
                    {t.execute}
                  </button>
                  <button onClick={() => void reject(plan)} type="button">
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
          ))
        )}
      </div>
    </section>
  );
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
