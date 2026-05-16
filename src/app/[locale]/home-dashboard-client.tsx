"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock3, Download, Gauge, Library, Loader2, Play, Rss, Sparkles } from "lucide-react";
import { getMessages } from "@/messages";
import type { Locale } from "@/lib/i18n";

type Dashboard = {
  continueWatching: Array<{
    episodeId: string;
    positionSec: number;
    durationSec?: number | null;
    title: string;
    episodeTitle?: string | null;
    episodeNumber: number;
    seasonNumber: number;
    posterUrl?: string | null;
    backdropUrl?: string | null;
    type: string;
  }>;
  recentMedia: Array<{
    id: string;
    type: string;
    title: string;
    year?: number | null;
    synopsis?: string | null;
    posterUrl?: string | null;
    backdropUrl?: string | null;
    episodeId?: string | null;
  }>;
  recentlyFetched: Array<{
    id: string;
    displayTitle: string;
    confidence: number;
    reviewRequired: boolean;
    _count: { candidates: number; subscriptions: number };
  }>;
  downloads: Record<string, number>;
  mediaCounts: Record<string, number>;
  subscriptions: Array<{
    id: string;
    title: string;
    autoDownload: boolean;
    frequencyMinutes: number;
  }>;
  storage?: {
    totalBytes: string;
    usedBytes: string;
    freeBytes: string;
    usedPercent: number;
  } | null;
};

type JobRunStatus = {
  key: "rss" | "downloads" | "organizerScan" | "aiReview" | "autoArchive";
  state: "SUCCESS" | "FAILED" | "NEVER";
  latestRun: {
    id: string;
    job: string;
    status: "SUCCESS" | "FAILED";
    finishedAt: string;
    durationMs: number;
    error?: string;
  } | null;
};

export function HomeDashboardClient({ locale }: { locale: Locale }) {
  const t = getMessages(locale);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [jobStatuses, setJobStatuses] = useState<JobRunStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const featured = useMemo(
    () => dashboard?.continueWatching[0] ?? dashboard?.recentMedia[0] ?? null,
    [dashboard],
  );

  const load = useCallback(async () => {
    try {
      const [dashboardResponse, jobStatusResponse] = await Promise.all([
        fetch("/api/dashboard"),
        fetch("/api/jobs/runs/status"),
      ]);
      if (!dashboardResponse.ok) {
        throw new Error(t.dashboardLoadError);
      }
      setDashboard((await dashboardResponse.json()) as Dashboard);
      if (jobStatusResponse.ok) {
        const payload = (await jobStatusResponse.json()) as { statuses: JobRunStatus[] };
        setJobStatuses(payload.statuses);
      }
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t.dashboardLoadError);
    } finally {
      setLoading(false);
    }
  }, [t.dashboardLoadError]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  if (loading) {
    return (
      <section className="content">
        <div className="settings-loading">
          <Loader2 size={18} />
          {t.loading}
        </div>
      </section>
    );
  }

  if (!dashboard) {
    return (
      <section className="content">
        <div className="settings-alert">{error || t.dashboardLoadError}</div>
      </section>
    );
  }

  return (
    <section className="content">
      <section className={featured ? "hero data-hero" : "hero empty-hero"}>
        {featured && "backdropUrl" in featured && featured.backdropUrl ? (
          <div
            className="hero-bg"
            style={{ backgroundImage: heroBackground(featured.backdropUrl) }}
          />
        ) : null}
        <div className="hero-copy">
          <div className="hero-meta">
            <span>
              <Sparkles size={12} />
              {featured ? t.library : t.noDashboardData}
            </span>
            {featured && "type" in featured ? <span>{featured.type}</span> : null}
          </div>
          <h1>{featured ? featured.title : t.emptyDashboardTitle}</h1>
          <p>
            {featured
              ? "episodeNumber" in featured
                ? `S${String(featured.seasonNumber).padStart(2, "0")}E${String(featured.episodeNumber).padStart(2, "0")} · ${featured.episodeTitle ?? t.unknownTitle}`
                : featured.synopsis || t.recentMedia
              : t.emptyDashboardDescription}
          </p>
          {featured && "episodeId" in featured && featured.episodeId ? (
            <div className="hero-actions">
              <a className="primary" href={`/${locale}/watch/${featured.episodeId}`}>
                <Play size={14} fill="currentColor" />
                {t.playNow}
              </a>
            </div>
          ) : null}
        </div>
      </section>

      <section className="stat-strip">
        <DashboardStat icon={<Sparkles size={16} />} label={t.anime} value={dashboard.mediaCounts.ANIME ?? 0} />
        <DashboardStat icon={<Library size={16} />} label={t.movies} value={dashboard.mediaCounts.MOVIE ?? 0} />
        <DashboardStat icon={<Library size={16} />} label={t.tv} value={dashboard.mediaCounts.TV ?? 0} />
        <DashboardStat icon={<Download size={16} />} label={t.downloads} value={dashboard.downloads.ACTIVE + dashboard.downloads.WAITING} />
        <DashboardStat icon={<Rss size={16} />} label={t.recentlyFetched} value={dashboard.recentlyFetched.length} />
      </section>

      <DashboardSection title={t.recentTaskStatus} empty={t.noJobActivity}>
        {jobStatuses.map((status) => (
          <MediaListItem
            href={`/${locale}/settings`}
            key={status.key}
            meta={formatJobStatusMeta(status, t)}
            title={jobStatusTitle(status.key, t)}
          />
        ))}
      </DashboardSection>

      <DashboardSection title={t.continueWatching} empty={t.noContinueWatching}>
        {dashboard.continueWatching.map((item) => (
          <MediaListItem
            href={`/${locale}/watch/${item.episodeId}`}
            key={item.episodeId}
            meta={`${Math.round(progressPercent(item.positionSec, item.durationSec))}% · S${item.seasonNumber}E${item.episodeNumber}`}
            posterUrl={item.posterUrl}
            title={item.title}
          />
        ))}
      </DashboardSection>

      <DashboardSection title={t.recentlyFetched} empty={t.noFetchedItems}>
        {dashboard.recentlyFetched.map((item) => (
          <MediaListItem
            href={`/${locale}/subscriptions`}
            key={item.id}
            meta={`${item._count.candidates} ${t.candidates} · ${Math.round(item.confidence * 100)}%`}
            title={item.displayTitle}
          />
        ))}
      </DashboardSection>

      <section className="dashboard-row">
        <div className="queue-panel">
          <SectionTitle icon={<Clock3 size={16} />} title={t.subscriptionQueue} />
          {dashboard.subscriptions.length === 0 ? (
            <p className="panel-empty">{t.noSubscriptions}</p>
          ) : (
            dashboard.subscriptions.map((subscription) => (
              <div className="queue-item" key={subscription.id}>
                <span>{subscription.title}</span>
                <b>{subscription.autoDownload ? "auto" : `${subscription.frequencyMinutes}m`}</b>
              </div>
            ))
          )}
        </div>

        <div className="overview-panel">
          <SectionTitle icon={<Gauge size={16} />} title={t.storageOverview} />
          <h2>
            {dashboard.storage ? formatBytes(dashboard.storage.usedBytes) : "--"}{" "}
            <span>/ {dashboard.storage ? formatBytes(dashboard.storage.totalBytes) : "--"} {t.used}</span>
          </h2>
          <div className="storage-bar">
            <span style={{ width: `${dashboard.storage?.usedPercent ?? 0}%` }} />
          </div>
          <div className="legend">
            <span>{t.available}: {dashboard.storage ? formatBytes(dashboard.storage.freeBytes) : "--"}</span>
            <span>{t.downloads}: {dashboard.downloads.ACTIVE + dashboard.downloads.WAITING}</span>
            <span>{t.organizer}: {dashboard.downloads.COMPLETED}</span>
          </div>
        </div>
      </section>
    </section>
  );
}

function DashboardStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div>
      {icon}
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function DashboardSection({
  children,
  empty,
  title,
}: {
  children: React.ReactNode[];
  empty: string;
  title: string;
}) {
  return (
    <section className="media-section">
      <div className="section-header">
        <SectionTitle icon={<Library size={16} />} title={title} />
      </div>
      <div className="dashboard-list">
        {children.length > 0 ? children : <p className="panel-empty">{empty}</p>}
      </div>
    </section>
  );
}

function MediaListItem({
  href,
  meta,
  posterUrl,
  title,
}: {
  href: string;
  meta: string;
  posterUrl?: string | null;
  title: string;
}) {
  return (
    <a className="dashboard-list-item" href={href}>
      <span style={{ backgroundImage: posterUrl ? `url(${posterUrl})` : undefined }} />
      <strong>{title}</strong>
      <small>{meta}</small>
    </a>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="section-title">
      <i />
      {icon}
      <h2>{title}</h2>
    </div>
  );
}

function progressPercent(position: number, duration?: number | null) {
  return duration && duration > 0 ? (position / duration) * 100 : 0;
}

function jobStatusTitle(key: JobRunStatus["key"], t: ReturnType<typeof getMessages>) {
  switch (key) {
    case "rss":
      return t.jobGroupRss;
    case "downloads":
      return t.jobGroupDownloads;
    case "organizerScan":
      return t.jobGroupOrganizerScan;
    case "aiReview":
      return t.jobGroupAiReview;
    case "autoArchive":
      return t.jobGroupAutoArchive;
  }
}

function formatJobStatusMeta(status: JobRunStatus, t: ReturnType<typeof getMessages>) {
  if (!status.latestRun) {
    return t.jobNeverRun;
  }
  const statusLabel =
    status.state === "SUCCESS" ? t.jobStatusSuccess : `${t.jobStatusFailed}: ${status.latestRun.error ?? status.latestRun.job}`;
  return `${statusLabel} · ${new Date(status.latestRun.finishedAt).toLocaleString()} · ${status.latestRun.durationMs}ms`;
}

function formatBytes(value: string) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function heroBackground(url: string) {
  return `linear-gradient(90deg, #000 0%, rgba(0, 0, 0, 0.72) 44%, rgba(0, 0, 0, 0.12) 100%), linear-gradient(0deg, #000 0%, rgba(0, 0, 0, 0) 45%), url("${url}")`;
}
