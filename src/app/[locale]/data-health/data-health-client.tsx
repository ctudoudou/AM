"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldCheck, Wrench } from "lucide-react";
import { getMessages } from "@/messages";
import type { Locale } from "@/lib/i18n";

type DataHealthIssue = {
  id: string;
  type: string;
  severity: "info" | "warning" | "danger";
  title: string;
  description: string;
  count: number;
  autoFixable: boolean;
  samples: Array<Record<string, unknown>>;
};

type DataHealthScan = {
  generatedAt: string;
  summary: {
    score: number;
    candidatesScanned: number;
    parserReplayIssues: number;
    pollutedGroups: number;
    splitGroups: number;
    organizerIssues: number;
    pollutedMediaFiles: number;
    autoFixableIssues: number;
  };
  issues: DataHealthIssue[];
};

type DataHealthRepairResponse = {
  repair: Record<string, unknown>;
  scan: DataHealthScan;
};

const dataHealthRequestTimeoutMs = 60_000;

export function DataHealthClient({ locale }: { locale: Locale }) {
  const t = getMessages(locale);
  const [scan, setScan] = useState<DataHealthScan | null>(null);
  const [loading, setLoading] = useState(true);
  const [repairing, setRepairing] = useState(false);
  const [error, setError] = useState("");
  const [repairMessage, setRepairMessage] = useState("");
  const [loadingSeconds, setLoadingSeconds] = useState(0);
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setLoadingSeconds(0);
    setError("");
    const startedAt = Date.now();
    const elapsedTimer = window.setInterval(() => {
      setLoadingSeconds(Math.max(1, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1000);
    const timeout = window.setTimeout(
      () => controller.abort("timeout"),
      dataHealthRequestTimeoutMs,
    );
    try {
      const response = await fetch("/api/data-health", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(t.dataHealthLoadError);
      }
      if (requestRef.current === controller) {
        setScan((await response.json()) as DataHealthScan);
      }
    } catch (loadError) {
      if (requestRef.current !== controller) {
        return;
      }
      setError(
        controller.signal.reason === "timeout"
          ? t.dataHealthLoadTimeout
          : loadError instanceof Error
            ? loadError.message
            : t.dataHealthLoadError,
      );
    } finally {
      window.clearInterval(elapsedTimer);
      window.clearTimeout(timeout);
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }, [t.dataHealthLoadError, t.dataHealthLoadTimeout]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load();
    }, 0);
    return () => {
      window.clearTimeout(timeout);
      requestRef.current?.abort();
    };
  }, [load]);

  async function repair() {
    setRepairing(true);
    setError("");
    setRepairMessage("");
    try {
      const response = await fetch("/api/data-health", { method: "POST" });
      if (!response.ok) {
        throw new Error(t.dataHealthRepairError);
      }
      const body = (await response.json()) as DataHealthRepairResponse;
      setScan(body.scan);
      setRepairMessage(t.dataHealthRepairDone);
    } catch (repairError) {
      setError(repairError instanceof Error ? repairError.message : t.dataHealthRepairError);
    } finally {
      setRepairing(false);
    }
  }

  const status = useMemo(() => {
    if (!scan) {
      return { className: "review", label: t.dataHealthUnknown };
    }
    if (scan.summary.score >= 92) {
      return { className: "ready", label: t.dataHealthGood };
    }
    if (scan.summary.score >= 70) {
      return { className: "review", label: t.dataHealthNeedsAttention };
    }
    return { className: "danger", label: t.dataHealthRisky };
  }, [scan, t.dataHealthGood, t.dataHealthNeedsAttention, t.dataHealthRisky, t.dataHealthUnknown]);

  if (loading && !scan) {
    return (
      <div aria-live="polite" className="settings-loading data-health-loading">
        <Loader2 size={18} />
        <div>
          <strong>{t.dataHealthLoading}</strong>
          <span>
            {loadingSeconds} {t.seconds}
            {loadingSeconds >= 12 ? ` · ${t.dataHealthLoadingSlow}` : ""}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-grid data-health-grid">
      {error ? <div className="settings-alert">{error}</div> : null}
      {repairMessage ? <div className="settings-success">{repairMessage}</div> : null}

      <section className="settings-panel wide data-health-hero">
        <div className="settings-panel-heading">
          <div>
            <h2>{t.dataHealthOverview}</h2>
            <p>{t.dataHealthOverviewDescription}</p>
            {loading ? (
              <small aria-live="polite" className="data-health-refresh-status">
                {t.dataHealthRefreshing} · {loadingSeconds} {t.seconds}
              </small>
            ) : null}
          </div>
          <div className="toolbar-actions">
            <button disabled={loading || repairing} onClick={() => void load()} type="button">
              {loading ? <Loader2 size={14} /> : <RefreshCw size={14} />}
              {t.refresh}
            </button>
            <button disabled={loading || repairing || !scan?.summary.autoFixableIssues} onClick={() => void repair()} type="button">
              {repairing ? <Loader2 size={14} /> : <Wrench size={14} />}
              {t.dataHealthRepair}
            </button>
          </div>
        </div>

        <div className="data-health-score-row">
          <div className={`data-health-score ${status.className}`}>
            <ShieldCheck size={22} />
            <strong>{scan?.summary.score ?? "--"}</strong>
            <span>{status.label}</span>
          </div>
          <Metric label={t.dataHealthCandidatesScanned} value={scan?.summary.candidatesScanned ?? 0} />
          <Metric label={t.dataHealthAutoFixable} value={scan?.summary.autoFixableIssues ?? 0} />
          <Metric label={t.dataHealthGeneratedAt} value={scan ? formatDate(scan.generatedAt) : "--"} />
        </div>
      </section>

      <MetricPanel label={t.dataHealthParserReplay} value={scan?.summary.parserReplayIssues ?? 0} />
      <MetricPanel label={t.dataHealthPollutedGroups} value={scan?.summary.pollutedGroups ?? 0} />
      <MetricPanel label={t.dataHealthSplitGroups} value={scan?.summary.splitGroups ?? 0} />
      <MetricPanel label={t.dataHealthOrganizerIssues} value={scan?.summary.organizerIssues ?? 0} />
      <MetricPanel label={t.dataHealthPollutedMediaFiles} value={scan?.summary.pollutedMediaFiles ?? 0} wide />

      <section className="settings-panel wide">
        <div className="settings-panel-heading">
          <div>
            <h2>{t.dataHealthIssues}</h2>
            <p>{t.dataHealthIssuesDescription}</p>
          </div>
        </div>
        {!scan || scan.issues.length === 0 ? (
          <div className="data-health-empty">
            <CheckCircle2 size={18} />
            {t.dataHealthNoIssues}
          </div>
        ) : (
          <div className="data-health-issue-list">
            {scan.issues.map((issue) => (
              <article key={issue.id} className={`data-health-issue ${issue.severity}`}>
                <div>
                  <strong>
                    {issue.severity === "danger" ? <AlertTriangle size={15} /> : <ShieldCheck size={15} />}
                    {issue.title}
                  </strong>
                  <p>{issue.description}</p>
                </div>
                <span>{issue.count}</span>
                <small>{issue.autoFixable ? t.dataHealthAutoFixable : t.dataHealthManualOnly}</small>
                {issue.samples.length > 0 ? (
                  <details>
                    <summary>{t.dataHealthSamples} ({Math.min(issue.samples.length, 3)})</summary>
                    <pre>{JSON.stringify(issue.samples.slice(0, 3), null, 2)}</pre>
                  </details>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="data-health-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MetricPanel({
  label,
  value,
  wide,
}: {
  label: string;
  value: number;
  wide?: boolean;
}) {
  return (
    <section className={wide ? "settings-panel wide data-health-stat" : "settings-panel data-health-stat"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </section>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
