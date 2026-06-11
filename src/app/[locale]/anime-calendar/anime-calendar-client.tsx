"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  Library,
  Loader2,
  Play,
  RefreshCw,
  Rss,
  Search,
} from "lucide-react";
import type {
  AnimeCalendarItem,
  AnimeCalendarProvider,
  AnimeCalendarQuarter,
  AnimeCalendarStatus,
} from "@/lib/anime-season-calendar";
import type { Locale } from "@/lib/i18n";
import { getMessages } from "@/messages";

type CalendarResponse = {
  provider: AnimeCalendarProvider;
  year: number;
  quarter: AnimeCalendarQuarter;
  generatedAt: string;
  providerNotice: string | null;
  items: AnimeCalendarItem[];
};

type CalendarStatusFilter = "ALL" | AnimeCalendarStatus;

const providers: AnimeCalendarProvider[] = ["bangumi", "jikan"];
const quarters: AnimeCalendarQuarter[] = ["Q1", "Q2", "Q3", "Q4"];
const statusFilters: CalendarStatusFilter[] = [
  "ALL",
  "UNMATCHED",
  "IN_LIBRARY",
  "PLAYABLE",
  "SUBSCRIBED",
  "DOWNLOADING",
  "MISSING",
];
const weekdays = [1, 2, 3, 4, 5, 6, 7];

export function AnimeCalendarClient({ locale }: { locale: Locale }) {
  const t = getMessages(locale);
  const current = useMemo(() => getCurrentClientQuarter(), []);
  const [provider, setProvider] = useState<AnimeCalendarProvider>("bangumi");
  const [year, setYear] = useState(current.year);
  const [quarter, setQuarter] = useState<AnimeCalendarQuarter>(current.quarter);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<CalendarStatusFilter>("ALL");
  const [calendar, setCalendar] = useState<CalendarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const yearOptions = useMemo(() => {
    const start = current.year - 2;
    return Array.from({ length: 6 }, (_item, index) => start + index);
  }, [current.year]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        provider,
        quarter,
        year: String(year),
      });
      const response = await fetch(`/api/anime-season-calendar?${params.toString()}`);
      if (!response.ok) {
        throw new Error(t.animeCalendarLoadError);
      }
      const body = (await response.json()) as CalendarResponse;
      setCalendar(body);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t.animeCalendarLoadError);
    } finally {
      setLoading(false);
    }
  }, [provider, quarter, t.animeCalendarLoadError, year]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load();
    });
    return () => window.clearTimeout(timeout);
  }, [load]);

  const visibleItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (calendar?.items ?? []).filter((item) => {
      if (needle && !calendarItemText(item).includes(needle)) {
        return false;
      }
      return statusFilter === "ALL" || itemStatus(item) === statusFilter;
    });
  }, [calendar?.items, query, statusFilter]);

  const stats = useMemo(() => {
    const items = calendar?.items ?? [];
    return {
      total: items.length,
      matched: items.filter((item) => item.local?.mediaId).length,
      playable: items.filter((item) => item.local?.playableEpisodes).length,
      subscribed: items.filter((item) => item.local?.subscribed).length,
      downloading: items.filter((item) => (item.local?.activeDownloads ?? 0) + (item.local?.waitingDownloads ?? 0) > 0).length,
    };
  }, [calendar?.items]);

  return (
    <div className="anime-calendar-workspace">
      <div className="anime-calendar-toolbar">
        <label className="library-search-field">
          <Search size={14} />
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.animeCalendarSearchPlaceholder}
            value={query}
          />
        </label>
        <div className="library-filter-controls anime-calendar-filters">
          <label>
            <span>{t.dataSource}</span>
            <select
              onChange={(event) => setProvider(event.target.value as AnimeCalendarProvider)}
              value={provider}
            >
              {providers.map((value) => (
                <option key={value} value={value}>
                  {providerLabel(value)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t.year}</span>
            <select onChange={(event) => setYear(Number(event.target.value))} value={year}>
              {yearOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t.quarter}</span>
            <select
              onChange={(event) => setQuarter(event.target.value as AnimeCalendarQuarter)}
              value={quarter}
            >
              {quarters.map((value) => (
                <option key={value} value={value}>
                  {quarterLabel(value, t)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t.status}</span>
            <select
              onChange={(event) => setStatusFilter(event.target.value as CalendarStatusFilter)}
              value={statusFilter}
            >
              {statusFilters.map((value) => (
                <option key={value} value={value}>
                  {statusFilterLabel(value, t)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button className="anime-calendar-refresh" disabled={loading} onClick={() => void load()} type="button">
          {loading ? <Loader2 size={14} /> : <RefreshCw size={14} />}
          {t.refresh}
        </button>
      </div>

      <section className="anime-calendar-summary" aria-label={t.animeCalendarSummary}>
        <SummaryMetric icon={<CalendarDays size={15} />} label={t.animeCalendarAiring} value={stats.total} />
        <SummaryMetric icon={<Library size={15} />} label={t.animeCalendarMatched} value={stats.matched} />
        <SummaryMetric icon={<Play size={15} />} label={t.animeCalendarPlayable} value={stats.playable} />
        <SummaryMetric icon={<Rss size={15} />} label={t.animeCalendarSubscribed} value={stats.subscribed} />
        <SummaryMetric icon={<Download size={15} />} label={t.animeCalendarDownloading} value={stats.downloading} />
      </section>

      {provider === "bangumi" ? (
        <div className="settings-status-row anime-calendar-notice">
          <span>{t.bangumiCurrentOnlyNotice}</span>
          <small>{calendar?.generatedAt ? formatDateTime(calendar.generatedAt, locale) : null}</small>
        </div>
      ) : null}
      {error ? <div className="settings-alert">{error}</div> : null}

      {loading && !calendar ? (
        <div className="settings-loading">
          <Loader2 size={16} />
          {t.loading}
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="empty-panel">{t.noAnimeCalendarItems}</div>
      ) : (
        <section className="anime-calendar-grid">
          {weekdays.map((weekday) => (
            <section className="anime-calendar-day" key={weekday}>
              <header>
                <strong>{weekdayLabel(weekday, t)}</strong>
                <span>{visibleItems.filter((item) => item.weekday === weekday).length}</span>
              </header>
              <div className="anime-calendar-day-list">
                {visibleItems
                  .filter((item) => item.weekday === weekday)
                  .map((item) => (
                    <CalendarCard item={item} key={`${item.provider}:${item.externalId}`} locale={locale} />
                  ))}
              </div>
            </section>
          ))}
        </section>
      )}
    </div>
  );
}

function CalendarCard({ item, locale }: { item: AnimeCalendarItem; locale: Locale }) {
  const t = getMessages(locale);
  const status = itemStatus(item);
  const local = item.local;
  const cover = local?.posterUrl ?? item.posterUrl;
  const totalEpisodeLabel = item.totalEpisodes ?? local?.archivedEpisodes ?? "-";

  return (
    <article className={`anime-calendar-card is-${status.toLowerCase().replace("_", "-")}`}>
      <div
        className="anime-calendar-poster"
        style={{ backgroundImage: cover ? `url(${cover})` : undefined }}
      >
        {!cover ? <span>{item.title.slice(0, 2)}</span> : null}
      </div>
      <div className="anime-calendar-card-body">
        <div className="anime-calendar-card-title">
          <h2>{item.title}</h2>
          <StatusBadge status={status} />
        </div>
        {secondaryTitle(item) ? <p>{secondaryTitle(item)}</p> : null}
        <div className="anime-calendar-meta">
          <span>
            <Clock3 size={12} />
            {broadcastLabel(item, t)}
          </span>
          {item.totalEpisodes ? <span>{item.totalEpisodes} {t.episodes}</span> : null}
          {item.score ? <span>{item.score.toFixed(1)}</span> : null}
        </div>
        <div className="anime-calendar-local-row">
          {local ? (
            <>
              <span>{local.playableEpisodes}/{totalEpisodeLabel}</span>
              {local.subscribed ? <span>{t.calendarStatusSubscribed}</span> : null}
              {local.wantedMissing > 0 ? <span>{t.missing} {local.wantedMissing}</span> : null}
            </>
          ) : (
            <span>{t.calendarStatusUnmatched}</span>
          )}
        </div>
        <div className="anime-calendar-actions">
          {local?.mediaId ? (
            <a href={`/${locale}/anime/${local.mediaId}`}>
              <Library size={13} />
              {t.openAnimeTitle}
            </a>
          ) : (
            <a href={`/${locale}/subscriptions`}>
              <Rss size={13} />
              {t.openSubscriptions}
            </a>
          )}
          {local?.nextEpisodeId ? (
            <a href={`/${locale}/watch/${local.nextEpisodeId}`}>
              <Play size={13} />
              {t.playNow}
            </a>
          ) : null}
          <a href={item.sourceUrl} rel="noreferrer" target="_blank">
            <ExternalLink size={13} />
            {providerLabel(item.provider)}
          </a>
        </div>
      </div>
    </article>
  );
}

function SummaryMetric({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div>
      <span>{icon}{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusBadge({ status }: { status: AnimeCalendarStatus }) {
  const Icon =
    status === "PLAYABLE" ? Play :
    status === "DOWNLOADING" ? Download :
    status === "SUBSCRIBED" ? Rss :
    status === "MISSING" ? AlertTriangle :
    status === "IN_LIBRARY" ? CheckCircle2 :
    Library;

  return (
    <span className="anime-calendar-status-badge">
      <Icon size={12} />
    </span>
  );
}

function itemStatus(item: AnimeCalendarItem): AnimeCalendarStatus {
  return item.local?.status ?? "UNMATCHED";
}

function calendarItemText(item: AnimeCalendarItem) {
  return [
    item.title,
    item.titleZhHans,
    item.titleNative,
    item.titleEnglish,
    item.local?.displayTitle,
  ].filter(Boolean).join(" ").toLowerCase();
}

function secondaryTitle(item: AnimeCalendarItem) {
  return [item.titleZhHans, item.titleNative, item.titleEnglish]
    .filter((value): value is string => Boolean(value) && value !== item.title)
    .slice(0, 2)
    .join(" / ");
}

function broadcastLabel(item: AnimeCalendarItem, t: ReturnType<typeof getMessages>) {
  const parts = [item.broadcastTime, item.timezone].filter(Boolean);
  if (parts.length > 0) {
    return parts.join(" ");
  }
  return item.airDate ?? t.unknownAirTime;
}

function providerLabel(provider: AnimeCalendarProvider) {
  return provider === "bangumi" ? "Bangumi" : "Jikan";
}

function quarterLabel(quarter: AnimeCalendarQuarter, t: ReturnType<typeof getMessages>) {
  return {
    Q1: t.calendarQ1,
    Q2: t.calendarQ2,
    Q3: t.calendarQ3,
    Q4: t.calendarQ4,
  }[quarter];
}

function weekdayLabel(weekday: number, t: ReturnType<typeof getMessages>) {
  return {
    1: t.weekdayMon,
    2: t.weekdayTue,
    3: t.weekdayWed,
    4: t.weekdayThu,
    5: t.weekdayFri,
    6: t.weekdaySat,
    7: t.weekdaySun,
  }[weekday] ?? t.weekdayMon;
}

function statusFilterLabel(status: CalendarStatusFilter, t: ReturnType<typeof getMessages>) {
  return {
    ALL: t.allStatuses,
    UNMATCHED: t.calendarStatusUnmatched,
    IN_LIBRARY: t.calendarStatusInLibrary,
    PLAYABLE: t.calendarStatusPlayable,
    SUBSCRIBED: t.calendarStatusSubscribed,
    DOWNLOADING: t.calendarStatusDownloading,
    MISSING: t.calendarStatusMissing,
  }[status];
}

function getCurrentClientQuarter() {
  const now = new Date();
  const month = now.getMonth() + 1;
  return {
    year: now.getFullYear(),
    quarter: month <= 3 ? "Q1" as const : month <= 6 ? "Q2" as const : month <= 9 ? "Q3" as const : "Q4" as const,
  };
}

function formatDateTime(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
