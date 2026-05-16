"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2, Play, Plus, RefreshCw, Trash2, WandSparkles } from "lucide-react";
import { getMessages } from "@/messages";
import type { Locale } from "@/lib/i18n";
import type {
  SubscriptionQueueDescription,
  SubscriptionQueueReason,
  SubscriptionQueueState,
} from "@/lib/subscription-queue-state";
import {
  type CandidateQueueSort,
  sortCandidateGroupsForQueue,
  summarizeCandidateGroupFreshness,
} from "./subscription-queue";

type RssSource = {
  id: string;
  name: string;
  url: string;
  mediaType: MediaType;
  enabled: boolean;
  _count?: { items: number };
  latestItem?: {
    createdAt?: string | null;
    publishedAt?: string | null;
    status?: string | null;
  } | null;
};

type JobRunSummary = {
  job: string;
  status: "SUCCESS" | "FAILED";
  finishedAt: string;
};

type MediaType = "ANIME" | "MOVIE" | "TV";
type IntakeMediaType = MediaType | "AUTO" | "";

type Candidate = {
  id: string;
  mediaType: MediaType;
  rawTitle: string;
  episodeNumber?: number | null;
  subtitleGroup?: string | null;
  resolution?: string | null;
  codec?: string | null;
  audio?: string | null;
  subtitleLanguage?: string | null;
  releaseProfile?: string | null;
  sourceKind?: string | null;
  variantKey?: string | null;
  status: string;
  createdAt?: string | null;
  rssItem?: {
    origin: string;
    createdAt?: string | null;
    publishedAt?: string | null;
    status: string;
    source?: {
      id: string;
      name: string;
    } | null;
  };
};

type CandidateGroup = {
  id: string;
  mediaType: MediaType;
  displayTitle: string;
  normalizedTitle: string;
  confidence: number;
  reviewRequired: boolean;
  aiSummary?: string | null;
  candidates: Candidate[];
  subscriptions?: Array<{ id: string }>;
  queueStatus?: SubscriptionQueueDescription;
  sourceSummary?: {
    candidateCount: number;
    latestFetchedAt?: string | null;
    latestMergedAt?: string | null;
    latestPublishedAt?: string | null;
    sources: Array<{ id: string | null; name: string; count: number }>;
  };
  _count: {
    candidates: number;
    subscriptions: number;
  };
};

type CandidateStats = {
  totalGroups: number;
  filteredGroups: number;
  activeGroups: number;
  subscribedGroups: number;
  emptyGroups: number;
  reviewGroups: number;
  ungroupedCandidates: number;
};

type CandidatePage = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
};

type Subscription = {
  id: string;
  candidateGroupId?: string | null;
  mediaType: MediaType;
  title: string;
  preferredGroup?: string | null;
  preferredResolution?: string | null;
  preferredCodec?: string | null;
  preferredAudio?: string | null;
  preferredSubtitleLanguage?: string | null;
  preferredReleaseProfile?: string | null;
  preferredSourceKind?: string | null;
  preferredVariantKey?: string | null;
  autoDownload: boolean;
  enabled: boolean;
  candidateGroup?: {
    displayTitle: string;
  } | null;
};

type CandidateFilter = "ACTIVE" | "UNSUBSCRIBED" | "SUBSCRIBED" | "EMPTY" | "ALL";
type MediaTypeFilter = MediaType | "ALL";
type SubscriptionModeFilter = "ALL" | "AUTO" | "MANUAL";
type CandidateStatusFilter = "ALL" | "ACTIONABLE" | "READY" | "REVIEW" | "SUBSCRIBED" | "EMPTY";

export function SubscriptionsClient({ locale }: { locale: Locale }) {
  const t = getMessages(locale);
  const [groups, setGroups] = useState<CandidateGroup[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [rssSources, setRssSources] = useState<RssSource[]>([]);
  const [queueRuns, setQueueRuns] = useState<{
    lastFetchRun: JobRunSummary | null;
    lastGroupRun: JobRunSummary | null;
  }>({ lastFetchRun: null, lastGroupRun: null });
  const [candidateFilter, setCandidateFilter] = useState<CandidateFilter>("ACTIVE");
  const [subscriptionQuery, setSubscriptionQuery] = useState("");
  const [subscriptionMediaType, setSubscriptionMediaType] = useState<MediaTypeFilter>("ALL");
  const [subscriptionMode, setSubscriptionMode] = useState<SubscriptionModeFilter>("ALL");
  const [candidateQuery, setCandidateQuery] = useState("");
  const [candidateMediaType, setCandidateMediaType] = useState<MediaTypeFilter>("ALL");
  const [candidateStatus, setCandidateStatus] = useState<CandidateStatusFilter>("ALL");
  const [candidateSort, setCandidateSort] = useState<CandidateQueueSort>("LATEST");
  const [candidateStats, setCandidateStats] = useState<CandidateStats>({
    totalGroups: 0,
    filteredGroups: 0,
    activeGroups: 0,
    subscribedGroups: 0,
    emptyGroups: 0,
    reviewGroups: 0,
    ungroupedCandidates: 0,
  });
  const [candidatePage, setCandidatePage] = useState(1);
  const [candidatePageInfo, setCandidatePageInfo] = useState<CandidatePage>({
    page: 1,
    pageSize: 50,
    total: 0,
    totalPages: 1,
    hasNext: false,
    hasPrevious: false,
  });
  const [rssDraft, setRssDraft] = useState<{ name: string; url: string; mediaType: MediaType }>({
    name: "",
    url: "",
    mediaType: "ANIME",
  });
  const [magnetUrl, setMagnetUrl] = useState("");
  const [magnetTitle, setMagnetTitle] = useState("");
  const [magnetMediaType, setMagnetMediaType] = useState<IntakeMediaType>("");
  const [torrentTitle, setTorrentTitle] = useState("");
  const [torrentMediaType, setTorrentMediaType] = useState<IntakeMediaType>("");
  const [torrentFile, setTorrentFile] = useState<File | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const groupsWithVersions = Math.max(0, candidateStats.totalGroups - candidateStats.emptyGroups);
  const visibleSubscriptions = useMemo(() => {
    const needle = subscriptionQuery.trim().toLowerCase();
    return subscriptions
      .filter((subscription) => {
        if (subscriptionMediaType !== "ALL" && subscription.mediaType !== subscriptionMediaType) {
          return false;
        }
        if (subscriptionMode === "AUTO" && !subscription.autoDownload) {
          return false;
        }
        if (subscriptionMode === "MANUAL" && subscription.autoDownload) {
          return false;
        }
        return !needle || matchesSubscriptionQuery(subscription, needle);
      })
      .sort((a, b) => a.title.localeCompare(b.title, locale));
  }, [locale, subscriptionMediaType, subscriptionMode, subscriptionQuery, subscriptions]);
  const visibleGroups = useMemo(() => {
    const subscriptionGroupIds = new Set(
      subscriptions
        .map((subscription) => subscription.candidateGroupId)
        .filter((id): id is string => Boolean(id)),
    );
    const needle = candidateQuery.trim().toLowerCase();
    const filteredGroups = groups
      .filter((group) => {
        if (candidateFilter === "ACTIVE" || candidateFilter === "UNSUBSCRIBED") {
          return group.candidates.length > 0;
        }
        if (candidateFilter === "SUBSCRIBED") {
          return subscriptionGroupIds.has(group.id);
        }
        if (candidateFilter === "EMPTY") {
          return group.candidates.length === 0;
        }
        return true;
      })
      .filter((group) => {
        if (candidateMediaType !== "ALL" && group.mediaType !== candidateMediaType) {
          return false;
        }
        if (candidateStatus !== "ALL" && !matchesCandidateStatus(group, candidateStatus, subscriptionGroupIds)) {
          return false;
        }
        return !needle || matchesCandidateQuery(group, needle);
      });
    return sortCandidateGroupsForQueue(filteredGroups, candidateSort, subscriptionGroupIds);
  }, [
    candidateFilter,
    candidateMediaType,
    candidateQuery,
    candidateSort,
    candidateStatus,
    groups,
    subscriptions,
  ]);

  const load = useCallback(async () => {
    try {
      const params = subscriptionCandidateParams({
        filter: candidateFilter,
        mediaType: candidateMediaType,
        page: candidatePage,
        query: candidateQuery,
        sort: candidateSort,
        status: candidateStatus,
      });
      const [candidateResponse, rssResponse, subscriptionsResponse] = await Promise.all([
        fetch(`/api/subscription-candidates?${params}`),
        fetch("/api/rss-sources"),
        fetch("/api/subscriptions"),
      ]);
      if (!candidateResponse.ok || !rssResponse.ok || !subscriptionsResponse.ok) {
        throw new Error(t.subscriptionsLoadError);
      }
      const candidateBody = (await candidateResponse.json()) as {
        groups: CandidateGroup[];
        stats?: CandidateStats;
        page?: CandidatePage;
      };
      const rssBody = (await rssResponse.json()) as {
        sources: RssSource[];
        queueStatus?: {
          lastFetchRun: JobRunSummary | null;
          lastGroupRun: JobRunSummary | null;
        };
      };
      const subscriptionsBody = (await subscriptionsResponse.json()) as {
        subscriptions: Subscription[];
      };
      setGroups(candidateBody.groups);
      setCandidateStats(
        candidateBody.stats ?? {
          totalGroups: candidateBody.groups.length,
          filteredGroups: candidateBody.groups.length,
          activeGroups: candidateBody.groups.filter((group) => group.candidates.length > 0).length,
          subscribedGroups: 0,
          emptyGroups: candidateBody.groups.filter((group) => group.candidates.length === 0).length,
          reviewGroups: candidateBody.groups.filter((group) => group.reviewRequired).length,
          ungroupedCandidates: 0,
        },
      );
      setCandidatePageInfo(
        candidateBody.page ?? {
          page: candidatePage,
          pageSize: candidateBody.groups.length,
          total: candidateBody.groups.length,
          totalPages: 1,
          hasNext: false,
          hasPrevious: candidatePage > 1,
        },
      );
      setRssSources(rssBody.sources);
      setQueueRuns(rssBody.queueStatus ?? { lastFetchRun: null, lastGroupRun: null });
      setSubscriptions(subscriptionsBody.subscriptions);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t.subscriptionsLoadError);
    } finally {
      setLoading(false);
    }
  }, [
    candidateFilter,
    candidateMediaType,
    candidatePage,
    candidateQuery,
    candidateSort,
    candidateStatus,
    t.subscriptionsLoadError,
  ]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  async function runJob(job: string) {
    setStatus("");
    setError("");
    const response = await fetch("/api/jobs/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job }),
    });
    if (!response.ok) {
      setError(t.jobRunError);
      return;
    }
    setStatus(t.jobQueued);
    await load();
  }

  async function addRssSource() {
    setStatus("");
    setError("");
    const response = await fetch("/api/rss-sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...rssDraft, enabled: true }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.message || body?.issues?.[0]?.message || t.rssSaveError);
      return;
    }

    setRssDraft({ name: "", url: "", mediaType: "ANIME" });
    setStatus(t.rssSourceAdded);
    await load();
  }

  async function toggleRssSource(source: RssSource) {
    const response = await fetch(`/api/rss-sources/${source.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !source.enabled }),
    });
    if (response.ok) {
      await load();
    }
  }

  async function deleteRssSource(source: RssSource) {
    const response = await fetch(`/api/rss-sources/${source.id}`, {
      method: "DELETE",
    });
    if (response.ok) {
      await load();
    }
  }

  async function addMagnet() {
    setStatus("");
    setError("");
    if (!magnetMediaType) {
      setError(t.mediaTypeRequired);
      return;
    }
    const response = await fetch("/api/intake/magnet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: magnetTitle, magnetUrl, mediaType: magnetMediaType }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.message || t.manualIntakeError);
      return;
    }
    setMagnetTitle("");
    setMagnetUrl("");
    setMagnetMediaType("");
    setStatus(t.manualIntakeCreated);
    await load();
  }

  async function addTorrent() {
    if (!torrentFile) {
      setError(t.torrentFileRequired);
      return;
    }
    if (!torrentMediaType) {
      setError(t.mediaTypeRequired);
      return;
    }
    const form = new FormData();
    form.set("title", torrentTitle);
    form.set("mediaType", torrentMediaType);
    form.set("file", torrentFile);
    const response = await fetch("/api/intake/torrent", {
      method: "POST",
      body: form,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.message || t.manualIntakeError);
      return;
    }
    setTorrentTitle("");
    setTorrentMediaType("");
    setTorrentFile(null);
    setStatus(t.manualIntakeCreated);
    await load();
  }

  async function createSubscription(group: CandidateGroup, candidate?: Candidate) {
    setStatus("");
    setError("");
    const response = await fetch("/api/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidateId: candidate?.id,
        candidateGroupId: group.id,
        preferredGroup: candidatePreferredGroup(candidate) ?? undefined,
        preferredResolution: candidate?.resolution ?? undefined,
        preferredCodec: candidate?.codec ?? undefined,
        preferredAudio: candidate?.audio ?? undefined,
        preferredSubtitleLanguage: candidate?.subtitleLanguage ?? undefined,
        preferredReleaseProfile: candidate?.releaseProfile ?? undefined,
        preferredSourceKind: candidate?.sourceKind ?? undefined,
        preferredVariantKey: candidate?.variantKey ?? undefined,
        autoDownload: Boolean(candidate),
        fallbackPolicy: "manual_review",
      }),
    });
    if (response.ok) {
      const body = (await response.json().catch(() => null)) as {
        downloadError?: string;
        replaced?: boolean;
      } | null;
      const message = body?.replaced ? t.subscriptionUpdated : t.subscriptionCreated;
      setStatus(
        body?.downloadError
          ? `${message} ${t.downloadCreateError}: ${body.downloadError}`
          : message,
      );
      await load();
    } else {
      const body = await response.json().catch(() => null);
      setError(body?.message || t.subscriptionCreateError);
    }
  }

  async function downloadCandidate(candidate: Candidate) {
    const response = await fetch(`/api/release-candidates/${candidate.id}/download`, {
      method: "POST",
    });
    if (response.ok) {
      setStatus(t.downloadCreated);
      await load();
    } else {
      setError(t.downloadCreateError);
    }
  }

  async function cancelSubscription(subscription: Subscription) {
    setStatus("");
    setError("");
    const response = await fetch(`/api/subscriptions/${subscription.id}`, {
      method: "DELETE",
    });
    if (response.ok) {
      setStatus(t.subscriptionCanceled);
      await load();
    } else {
      setError(t.subscriptionCancelError);
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
    <div className="settings-grid">
      <section className="settings-panel wide">
        <div className="settings-panel-heading">
          <div>
            <h2>{t.rssSources}</h2>
            <p>
              {t.subscriptionsRssDescription}
              {formatQueueRunSummary(queueRuns, locale, t)}
            </p>
          </div>
          <button onClick={() => void runJob("rss.fetchAll")} type="button">
            <RefreshCw size={14} />
            {t.fetchAndGroup}
          </button>
        </div>
        <div className="rss-draft">
          <input
            onChange={(event) =>
              setRssDraft({ ...rssDraft, name: event.target.value })
            }
            placeholder={t.rssName}
            value={rssDraft.name}
          />
          <input
            onChange={(event) =>
              setRssDraft({ ...rssDraft, url: event.target.value })
            }
            placeholder={t.rssUrl}
            value={rssDraft.url}
          />
          <select
            aria-label={t.mediaType}
            onChange={(event) =>
              setRssDraft({ ...rssDraft, mediaType: event.target.value as MediaType })
            }
            value={rssDraft.mediaType}
          >
            {mediaTypeOptions.map((option) => (
              <option key={option} value={option}>
                {formatMediaType(option, t)}
              </option>
            ))}
          </select>
          <button onClick={addRssSource} type="button">
            <Plus size={14} />
            {t.add}
          </button>
        </div>
        <div className="rss-list">
          {rssSources.length === 0 ? (
            <p>{t.noRssSources}</p>
          ) : (
            rssSources.map((source) => (
              <article key={source.id}>
                <button
                  className={source.enabled ? "toggle active" : "toggle"}
                  onClick={() => void toggleRssSource(source)}
                  type="button"
                >
                  {source.enabled ? t.enabled : t.disabled}
                </button>
                <div>
                  <h3>{source.name}</h3>
                  <p>
                    {formatMediaType(source.mediaType, t)} · {source.url}
                  </p>
                  <p>
                    {t.rssItems}: {source._count?.items ?? 0}
                    {source.latestItem?.createdAt
                      ? ` · ${t.latestFetched}: ${formatShortDate(source.latestItem.createdAt, locale)}`
                      : ""}
                    {source.latestItem?.status ? ` · ${source.latestItem.status}` : ""}
                  </p>
                </div>
                <button
                  className="icon-button"
                  onClick={() => void deleteRssSource(source)}
                  type="button"
                >
                  ×
                </button>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="settings-panel wide">
        <div className="settings-panel-heading">
          <div>
            <h2>{t.rssAiPipeline}</h2>
            <p>{t.rssAiPipelineDescription}</p>
          </div>
          <div className="toolbar-actions">
            <button onClick={() => void runJob("rss.fetchAll")} type="button">
              <RefreshCw size={14} />
              {t.fetchAndGroup}
            </button>
            <button onClick={() => void runJob("ai.groupCandidates")} type="button">
              <WandSparkles size={14} />
              {t.aiGroup}
            </button>
            <button onClick={() => void runJob("ai.repairCandidateGroups")} type="button">
              <WandSparkles size={14} />
              {t.repairGroups}
            </button>
          </div>
        </div>
        <div className="rss-draft">
          <select
            aria-label={t.mediaType}
            onChange={(event) => setMagnetMediaType(event.target.value as IntakeMediaType)}
            value={magnetMediaType}
          >
            <option value="">{t.selectMediaType}</option>
            {intakeMediaTypeOptions.map((option) => (
              <option key={option} value={option}>
                {formatMediaType(option, t)}
              </option>
            ))}
          </select>
          <input
            onChange={(event) => setMagnetTitle(event.target.value)}
            placeholder={t.manualTitle}
            value={magnetTitle}
          />
          <input
            onChange={(event) => setMagnetUrl(event.target.value)}
            placeholder={t.magnetUrl}
            value={magnetUrl}
          />
          <button disabled={!magnetMediaType} onClick={addMagnet} type="button">
            <Plus size={14} />
            {t.addMagnet}
          </button>
        </div>
        <div className="rss-draft">
          <select
            aria-label={t.mediaType}
            onChange={(event) => setTorrentMediaType(event.target.value as IntakeMediaType)}
            value={torrentMediaType}
          >
            <option value="">{t.selectMediaType}</option>
            {intakeMediaTypeOptions.map((option) => (
              <option key={option} value={option}>
                {formatMediaType(option, t)}
              </option>
            ))}
          </select>
          <input
            onChange={(event) => setTorrentTitle(event.target.value)}
            placeholder={t.manualTitle}
            value={torrentTitle}
          />
          <input
            accept=".torrent"
            onChange={(event) => setTorrentFile(event.target.files?.[0] ?? null)}
            type="file"
          />
          <button disabled={!torrentMediaType} onClick={addTorrent} type="button">
            <Plus size={14} />
            {t.addTorrent}
          </button>
        </div>
      </section>

      {status ? <div className="settings-status-row"><span>{status}</span></div> : null}
      {error ? <div className="settings-alert">{error}</div> : null}

      <section className="settings-panel wide">
        <div className="settings-panel-heading">
          <div>
            <h2>{t.activeSubscriptions}</h2>
            <p>{t.activeSubscriptionsDescription}</p>
          </div>
          <span className="panel-count">
            {visibleSubscriptions.length} / {subscriptions.length}
          </span>
        </div>
        <div className="subscription-controls">
          <label className="settings-search-field">
            <input
              onChange={(event) => setSubscriptionQuery(event.target.value)}
              placeholder={t.filterSubscriptions}
              value={subscriptionQuery}
            />
          </label>
          <select
            aria-label={t.mediaType}
            onChange={(event) => setSubscriptionMediaType(event.target.value as MediaTypeFilter)}
            value={subscriptionMediaType}
          >
            <option value="ALL">{t.allMediaTypes}</option>
            {mediaTypeOptions.map((option) => (
              <option key={option} value={option}>
                {formatMediaType(option, t)}
              </option>
            ))}
          </select>
          <select
            aria-label={t.subscriptionMode}
            onChange={(event) => setSubscriptionMode(event.target.value as SubscriptionModeFilter)}
            value={subscriptionMode}
          >
            <option value="ALL">{t.subscriptionModeAll}</option>
            <option value="AUTO">{t.subscriptionModeAuto}</option>
            <option value="MANUAL">{t.subscriptionModeManual}</option>
          </select>
        </div>
        <div className="subscription-list compact">
          {subscriptions.length === 0 ? (
            <p>{t.noActiveSubscriptions}</p>
          ) : visibleSubscriptions.length === 0 ? (
            <p>{t.noMatchingResults}</p>
          ) : (
            visibleSubscriptions.map((subscription) => (
              <article key={subscription.id}>
                <div>
                  <h3>{subscription.title}</h3>
                  <div className="subscription-row-tags">
                    <span>{formatMediaType(subscription.mediaType, t)}</span>
                    <span>
                      {subscription.autoDownload ? t.subscriptionModeAuto : t.subscriptionModeManual}
                    </span>
                    {subscription.candidateGroup?.displayTitle &&
                    subscription.candidateGroup.displayTitle !== subscription.title ? (
                      <span>{subscription.candidateGroup.displayTitle}</span>
                    ) : null}
                  </div>
                  <p>{formatSubscriptionPolicy(subscription) || t.futureOnlyPolicy}</p>
                </div>
                <button
                  className="danger-button"
                  onClick={() => void cancelSubscription(subscription)}
                  type="button"
                >
                  <Trash2 size={14} />
                  {t.cancelSubscription}
                </button>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="candidate-board">
        <div className="candidate-board-heading">
          <div>
            <h2>{t.subscriptionQueue}</h2>
            <p>
              {visibleGroups.length} / {candidatePageInfo.total} {t.titles} ·{" "}
              {groupsWithVersions} {t.withVersions} ·{" "}
              {candidateStats.ungroupedCandidates} {t.ungroupedCandidates}
            </p>
          </div>
          <div className="candidate-board-tools">
            <div className="filter-tabs">
              {[
                ["ACTIVE", t.currentCandidates],
                ["UNSUBSCRIBED", t.unsubscribed],
                ["SUBSCRIBED", t.subscribed],
                ["EMPTY", t.futureOnly],
                ["ALL", t.subscriptionFilterAll],
              ].map(([key, label]) => (
                <button
                  className={candidateFilter === key ? "active" : ""}
                  key={key}
                  onClick={() => {
                    setCandidatePage(1);
                    setCandidateFilter(
                      key as CandidateFilter,
                    );
                  }}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="candidate-filter-bar">
              <input
                onChange={(event) => {
                  setCandidatePage(1);
                  setCandidateQuery(event.target.value);
                }}
                placeholder={t.queueSearch}
                value={candidateQuery}
              />
              <select
                aria-label={t.mediaType}
                onChange={(event) => {
                  setCandidatePage(1);
                  setCandidateMediaType(event.target.value as MediaTypeFilter);
                }}
                value={candidateMediaType}
              >
                <option value="ALL">{t.allMediaTypes}</option>
                {mediaTypeOptions.map((option) => (
                  <option key={option} value={option}>
                    {formatMediaType(option, t)}
                  </option>
                ))}
              </select>
              <select
                aria-label={t.queueStatus}
                onChange={(event) => {
                  setCandidatePage(1);
                  setCandidateStatus(event.target.value as CandidateStatusFilter);
                }}
                value={candidateStatus}
              >
                <option value="ALL">{t.subscriptionFilterAll}</option>
                <option value="ACTIONABLE">{t.queueStatusActionable}</option>
                <option value="READY">{t.queueStatusReady}</option>
                <option value="REVIEW">{t.queueStatusReview}</option>
                <option value="SUBSCRIBED">{t.queueStatusSubscribed}</option>
                <option value="EMPTY">{t.queueStatusEmpty}</option>
              </select>
              <select
                aria-label={t.sortBy}
                onChange={(event) => setCandidateSort(event.target.value as CandidateQueueSort)}
                value={candidateSort}
              >
                <option value="LATEST">{t.queueSortLatest}</option>
                <option value="UNSUBSCRIBED">{t.queueSortUnsubscribed}</option>
                <option value="VERSIONS">{t.queueSortVersions}</option>
                <option value="REVIEW">{t.queueSortReview}</option>
              </select>
            </div>
          </div>
        </div>
        <div className="candidate-stats-row">
          <span>{t.queueTotal}: {candidateStats.totalGroups}</span>
          <span>{t.currentCandidates}: {candidateStats.activeGroups}</span>
          <span>{t.subscribed}: {candidateStats.subscribedGroups}</span>
          <span>{t.queueStatusReview}: {candidateStats.reviewGroups}</span>
          <span>{t.futureOnly}: {candidateStats.emptyGroups}</span>
        </div>
        {visibleGroups.length === 0 ? (
          <div className="empty-panel">
            {groups.length === 0 ? t.noCandidates : t.noMatchingResults}
          </div>
        ) : (
          visibleGroups.map((group) => {
            const groupSubscriptions = subscriptions.filter(
              (subscription) => subscription.candidateGroupId === group.id,
            );
            const hasSubscription = groupSubscriptions.length > 0;
            const freshness = summarizeCandidateGroupFreshness(group);
            const queueStatus = group.queueStatus ?? fallbackQueueStatus(group, hasSubscription);

            return (
              <article className="candidate-group" key={group.id}>
                <div className="candidate-heading">
                  <div>
                    <h2>{group.displayTitle}</h2>
                    <p>
                      {formatMediaType(group.mediaType, t)} ·{" "}
                      {group._count.candidates} {t.candidates} ·{" "}
                      {Math.round(group.confidence * 100)}% ·{" "}
                      {group.reviewRequired ? t.needsReview : t.ready}
                      {freshness ? (
                        <>
                          {" · "}
                          {formatCandidateFreshness(freshness, locale, t)}
                        </>
                      ) : null}
                      {group.sourceSummary ? (
                        <>
                          {" · "}
                          {formatCandidateSourceSummary(group.sourceSummary, locale, t)}
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="candidate-heading-actions">
                    <span className={hasSubscription ? "candidate-policy active" : "candidate-policy"}>
                      {formatQueueState(queueStatus.state, t)}
                    </span>
                    {!hasSubscription ? (
                      <button onClick={() => void createSubscription(group)} type="button">
                        <Plus size={14} />
                        {t.futureOnlySubscribe}
                      </button>
                    ) : null}
                  </div>
                </div>
                <p className="candidate-summary">{formatQueueReason(queueStatus.reason, t)}</p>
                {group.aiSummary ? <p className="candidate-summary">{group.aiSummary}</p> : null}
                {group.candidates.length === 0 ? (
                  <div className="candidate-empty-version">
                    {t.noVersionsYet} {formatQueueReason(queueStatus.reason, t)}
                  </div>
                ) : (
                  <div className="candidate-list">
                    {groupCandidatesByEpisode(group.candidates).map((episode) => (
                      <div className="candidate-episode" key={episode.key}>
                        <div className="candidate-episode-heading">
                          <span>
                            {t.episode} {episode.label}
                          </span>
                          <small>
                            {episode.candidates.length} {t.candidates}
                          </small>
                        </div>
                        {episode.candidates.map((candidate) => {
                          const isSubscribed = groupSubscriptions.some((subscription) =>
                            candidateMatchesSubscription(candidate, subscription),
                          );
                          const hasOtherSubscription = hasSubscription && !isSubscribed;

                          return (
                            <div className="candidate-row" key={candidate.id}>
                              <div>
                                <strong>{candidate.rawTitle}</strong>
                                <span className="candidate-row-meta">
                                  {formatCandidateMeta(candidate, locale)}
                                </span>
                              </div>
                              <div className="candidate-actions">
                                <button
                                  disabled={isSubscribed}
                                  onClick={() => void createSubscription(group, candidate)}
                                  type="button"
                                >
                                  <Play size={14} />
                                  {isSubscribed
                                    ? t.matchedSubscribedVersion
                                    : hasOtherSubscription
                                      ? t.switchVersion
                                      : t.subscribeVersion}
                                </button>
                                <button onClick={() => void downloadCandidate(candidate)} type="button">
                                  <Download size={14} />
                                  {t.download}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </article>
            );
          })
        )}
        <div className="candidate-pagination">
          <span>
            {t.queuePage} {candidatePageInfo.page} / {candidatePageInfo.totalPages} ·{" "}
            {t.queueShowing} {pageRangeLabel(candidatePageInfo)}
          </span>
          <div>
            <button
              disabled={!candidatePageInfo.hasPrevious}
              onClick={() => setCandidatePage((page) => Math.max(1, page - 1))}
              type="button"
            >
              {t.queuePrevious}
            </button>
            <button
              disabled={!candidatePageInfo.hasNext}
              onClick={() => setCandidatePage((page) => page + 1)}
              type="button"
            >
              {t.queueNext}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function groupCandidatesByEpisode(candidates: Candidate[]) {
  const grouped = new Map<
    string,
    { key: string; label: string; candidates: Candidate[] }
  >();

  for (const candidate of candidates) {
    const label =
      candidate.episodeNumber === null || candidate.episodeNumber === undefined
        ? "-"
        : String(candidate.episodeNumber).padStart(2, "0");
    const key = label === "-" ? `unknown-${candidate.id}` : label;
    const group = grouped.get(key) ?? { key, label, candidates: [] };
    group.candidates.push(candidate);
    grouped.set(key, group);
  }

  return [...grouped.values()];
}

function formatCandidateMeta(candidate: Candidate, locale: Locale) {
  const profileParts = splitReleaseProfile(candidate.releaseProfile);
  const hasCantoneseAudio = [candidate.subtitleGroup, candidate.releaseProfile, candidate.sourceKind]
    .filter(Boolean)
    .some((value) => isCantoneseAudioTag(value as string));
  const hasTvbCantonese = [candidate.subtitleGroup, candidate.releaseProfile]
    .filter(Boolean)
    .some((value) => /\btvb\b/i.test(value as string) && isCantoneseAudioTag(value as string));
  const sourceKind =
    candidate.sourceKind ??
    (profileParts.some((part) => /\bweb\b/i.test(part)) ? "WEB" : undefined);
  const labels = candidateMetaLabels(locale);
  const cleanedProfileParts = profileParts
    .filter((part) => !isCantoneseAudioTag(part))
    .filter((part) => !isSourceOnlyMeta(part))
    .filter((part) => normalizeMetaAtom(part) !== normalizeMetaAtom(sourceKind ?? ""))
    .map(normalizeReleaseProfileLabel);

  return [
    candidatePreferredGroup(candidate),
    hasTvbCantonese ? `${labels.version}: TVB ${labels.cantonese}` : null,
    hasCantoneseAudio ? `${labels.audioLanguage}: ${labels.cantonese}` : null,
    ...cleanedProfileParts,
    candidate.subtitleLanguage ? `${labels.subtitles}: ${candidate.subtitleLanguage}` : null,
    sourceKind ? `${labels.source}: ${sourceKind}` : null,
    candidate.resolution,
    candidate.codec,
    candidate.audio,
    candidate.status,
  ]
    .filter(Boolean)
    .join(" · ");
}

function candidatePreferredGroup(candidate?: Candidate) {
  if (!candidate?.subtitleGroup || isCantoneseAudioTag(candidate.subtitleGroup)) {
    return null;
  }
  return candidate.subtitleGroup;
}

function splitReleaseProfile(value?: string | null) {
  return (value ?? "")
    .split(/\s+\/\s+|·/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function isCantoneseAudioTag(value: string) {
  return /(?:粵語|粤语|廣東話|广东话|\byue\b|cantonese)/i.test(value);
}

function isSourceOnlyMeta(value: string) {
  return /^(?:web|web-dl|webrip|baha|cr|crunchyroll|abema|b-global|netflix|amazon|bilibili|tv|bd|blu-ray)$/i.test(
    value.trim(),
  );
}

function normalizeReleaseProfileLabel(value: string) {
  return value
    .replace(/粵語/g, "粤语")
    .replace(/\bWEB\s+YUE\b/gi, "WEB")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMetaAtom(value: string) {
  return value.toLowerCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
}

function candidateMetaLabels(locale: Locale) {
  if (locale === "en") {
    return {
      audioLanguage: "Audio",
      cantonese: "Cantonese",
      source: "Source",
      subtitles: "Subtitles",
      version: "Version",
    };
  }
  return {
    audioLanguage: "音轨",
    cantonese: "粤语",
    source: "来源",
    subtitles: "字幕",
    version: "版本",
  };
}

function formatSubscriptionPolicy(subscription: Subscription) {
  return [
    subscription.preferredGroup,
    subscription.preferredReleaseProfile,
    subscription.preferredSubtitleLanguage,
    subscription.preferredSourceKind,
    subscription.preferredResolution,
    subscription.preferredCodec,
    subscription.preferredAudio,
    subscription.autoDownload ? "Auto" : "Manual",
  ]
    .filter(Boolean)
    .join(" · ");
}

function candidateMatchesSubscription(candidate: Candidate, subscription: Subscription) {
  if (subscription.preferredVariantKey) {
    return candidate.variantKey === subscription.preferredVariantKey;
  }

  const checks = [
    [subscription.preferredGroup, candidate.subtitleGroup],
    [subscription.preferredResolution, candidate.resolution],
    [subscription.preferredCodec, candidate.codec],
    [subscription.preferredAudio, candidate.audio],
    [subscription.preferredSubtitleLanguage, candidate.subtitleLanguage],
    [subscription.preferredReleaseProfile, candidate.releaseProfile],
    [subscription.preferredSourceKind, candidate.sourceKind],
  ] as const;

  if (!checks.some(([preferred]) => Boolean(preferred))) {
    return candidate.status === "SUBSCRIBED";
  }

  return checks.every(([preferred, actual]) => !preferred || preferred === actual);
}

function matchesSubscriptionQuery(subscription: Subscription, needle: string) {
  return [
    subscription.title,
    subscription.candidateGroup?.displayTitle ?? "",
    subscription.preferredGroup ?? "",
    subscription.preferredResolution ?? "",
    subscription.preferredCodec ?? "",
    subscription.preferredAudio ?? "",
    subscription.preferredSubtitleLanguage ?? "",
    subscription.preferredReleaseProfile ?? "",
    subscription.preferredSourceKind ?? "",
  ].some((value) => value.toLowerCase().includes(needle));
}

function matchesCandidateQuery(group: CandidateGroup, needle: string) {
  return [
    group.displayTitle,
    group.normalizedTitle,
    group.aiSummary ?? "",
    ...group.candidates.flatMap((candidate) => [
      candidate.rawTitle,
      candidate.subtitleGroup ?? "",
      candidate.resolution ?? "",
      candidate.codec ?? "",
      candidate.audio ?? "",
      candidate.subtitleLanguage ?? "",
      candidate.releaseProfile ?? "",
      candidate.sourceKind ?? "",
    ]),
  ].some((value) => value.toLowerCase().includes(needle));
}

function matchesCandidateStatus(
  group: CandidateGroup,
  status: CandidateStatusFilter,
  subscriptionGroupIds: Set<string>,
) {
  if (status === "ACTIONABLE") {
    return (
      group.candidates.length > 0 &&
      !group.reviewRequired &&
      !subscriptionGroupIds.has(group.id)
    );
  }
  if (status === "READY") {
    return group.candidates.length > 0 && !group.reviewRequired;
  }
  if (status === "REVIEW") {
    return group.reviewRequired;
  }
  if (status === "SUBSCRIBED") {
    return subscriptionGroupIds.has(group.id);
  }
  if (status === "EMPTY") {
    return group.candidates.length === 0;
  }
  return true;
}

const mediaTypeOptions: MediaType[] = ["ANIME", "MOVIE", "TV"];
const intakeMediaTypeOptions: Array<Exclude<IntakeMediaType, "">> = [
  "ANIME",
  "MOVIE",
  "TV",
  "AUTO",
];

function formatMediaType(
  value: MediaType | "AUTO",
  t: ReturnType<typeof getMessages>,
) {
  if (value === "ANIME") {
    return t.anime;
  }
  if (value === "MOVIE") {
    return t.movies;
  }
  if (value === "TV") {
    return t.tv;
  }
  return t.autoDetect;
}

function pageRangeLabel(page: CandidatePage) {
  if (page.total === 0) {
    return "0 / 0";
  }
  const start = (page.page - 1) * page.pageSize + 1;
  const end = Math.min(page.page * page.pageSize, page.total);
  return `${start}-${end} / ${page.total}`;
}

function formatCandidateFreshness(
  freshness: ReturnType<typeof summarizeCandidateGroupFreshness>,
  locale: Locale,
  t: ReturnType<typeof getMessages>,
) {
  if (!freshness) {
    return "";
  }
  const parts = [freshness.sourceKind ? `${t.latestSource}: ${freshness.sourceKind}` : null];
  if (freshness.createdAt) {
    const date = new Date(freshness.createdAt);
    if (Number.isFinite(date.getTime())) {
      parts.push(
        `${t.latestCandidate}: ${new Intl.DateTimeFormat(locale, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }).format(date)}`,
      );
    }
  }
  return parts.filter(Boolean).join(" · ");
}

function formatCandidateSourceSummary(
  summary: NonNullable<CandidateGroup["sourceSummary"]>,
  locale: Locale,
  t: ReturnType<typeof getMessages>,
) {
  const sources = summary.sources
    .slice(0, 2)
    .map((source) => `${source.name} (${source.count})`)
    .join(", ");
  const parts = [
    sources ? `${t.candidateSources}: ${sources}` : null,
    summary.latestFetchedAt
      ? `${t.latestFetched}: ${formatShortDate(summary.latestFetchedAt, locale)}`
      : null,
    summary.latestMergedAt
      ? `${t.latestMerged}: ${formatShortDate(summary.latestMergedAt, locale)}`
      : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

function fallbackQueueStatus(
  group: CandidateGroup,
  hasSubscription: boolean,
): SubscriptionQueueDescription {
  if (hasSubscription) {
    return { state: "SUBSCRIBED", reason: "alreadySubscribed", canSubscribeVersion: false };
  }
  if (group.candidates.length === 0) {
    return { state: "EMPTY", reason: "noVersions", canSubscribeVersion: false };
  }
  if (group.reviewRequired) {
    return { state: "REVIEW_REQUIRED", reason: "needsReview", canSubscribeVersion: true };
  }
  return { state: "ACTIONABLE", reason: "readyToSubscribe", canSubscribeVersion: true };
}

function formatQueueState(
  state: SubscriptionQueueState,
  t: ReturnType<typeof getMessages>,
) {
  if (state === "ACTIONABLE") {
    return t.queueStatusActionable;
  }
  if (state === "REVIEW_REQUIRED") {
    return t.queueStatusReview;
  }
  if (state === "SUBSCRIBED") {
    return t.queueStatusSubscribed;
  }
  return t.queueStatusEmpty;
}

function formatQueueReason(
  reason: SubscriptionQueueReason,
  t: ReturnType<typeof getMessages>,
) {
  if (reason === "readyToSubscribe") {
    return t.queueReasonReadyToSubscribe;
  }
  if (reason === "needsReview") {
    return t.queueReasonNeedsReview;
  }
  if (reason === "alreadySubscribed") {
    return t.queueReasonAlreadySubscribed;
  }
  return t.queueReasonNoVersions;
}

function formatQueueRunSummary(
  runs: { lastFetchRun: JobRunSummary | null; lastGroupRun: JobRunSummary | null },
  locale: Locale,
  t: ReturnType<typeof getMessages>,
) {
  const parts = [
    runs.lastFetchRun
      ? `${t.lastFetchRun}: ${formatJobRun(runs.lastFetchRun, locale, t)}`
      : null,
    runs.lastGroupRun
      ? `${t.lastGroupRun}: ${formatJobRun(runs.lastGroupRun, locale, t)}`
      : null,
  ].filter(Boolean);
  return parts.length > 0 ? ` ${parts.join(" · ")}` : "";
}

function formatJobRun(
  run: JobRunSummary,
  locale: Locale,
  t: ReturnType<typeof getMessages>,
) {
  const status = run.status === "SUCCESS" ? t.jobStatusSuccess : t.jobStatusFailed;
  return `${status} ${formatShortDate(run.finishedAt, locale)}`;
}

function formatShortDate(value: string, locale: Locale) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function subscriptionCandidateParams(input: {
  filter: CandidateFilter;
  mediaType: MediaTypeFilter;
  page: number;
  query: string;
  sort: CandidateQueueSort;
  status: CandidateStatusFilter;
}) {
  const params = new URLSearchParams();
  if (input.filter === "SUBSCRIBED") {
    params.set("view", "subscribed");
  } else if (input.filter === "EMPTY") {
    params.set("view", "empty");
  } else if (input.filter === "ALL") {
    params.set("view", "all");
  } else {
    params.set("view", "active");
  }
  params.set("page", String(input.page));
  params.set("pageSize", "50");
  params.set("sort", input.sort);
  if (input.mediaType !== "ALL") {
    params.set("mediaType", input.mediaType);
  }
  if (input.status !== "ALL") {
    params.set("status", input.status);
  }
  if (input.query.trim()) {
    params.set("q", input.query.trim());
  }
  return params.toString();
}
