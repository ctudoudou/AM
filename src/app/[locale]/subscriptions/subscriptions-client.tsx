"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import { getMessages } from "@/messages";
import type { Locale } from "@/lib/i18n";
import {
  candidateIsBatch,
  evaluateSubscriptionCandidates,
  selectSubscriptionCandidate,
  type StrategyCandidate,
  type SubscriptionCandidateEvaluation,
  type SubscriptionStrategy,
} from "@/lib/subscription-strategy";
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
  season?: number | null;
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
  season?: number | null;
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
  fallbackPolicy?: string | null;
  seasonMode?: string | null;
  seasonNumber?: number | null;
  episodeMode?: string | null;
  episodeStart?: number | null;
  episodeEnd?: number | null;
  batchPolicy?: string | null;
  autoDownload: boolean;
  enabled: boolean;
  candidateGroup?: {
    displayTitle: string;
  } | null;
};

type CandidateFilter = "ACTIVE" | "BATCH" | "UNSUBSCRIBED" | "SUBSCRIBED" | "EMPTY" | "ALL";
type MediaTypeFilter = MediaType | "ALL";
type SubscriptionModeFilter = "ALL" | "AUTO" | "MANUAL";
type CandidateStatusFilter = "ALL" | "ACTIONABLE" | "READY" | "REVIEW" | "SUBSCRIBED" | "EMPTY";
type SubscriptionStrategyDraft = {
  title: string;
  seasonMode: "latest" | "specific" | "unknown_review";
  seasonNumber: number | null;
  episodeMode: "future_only" | "missing_only" | "range" | "all";
  episodeStart: number | null;
  episodeEnd: number | null;
  batchPolicy: "reject" | "review" | "allow";
  autoDownload: boolean;
};
type PendingSubscription = {
  group: CandidateGroup;
  candidate?: Candidate;
  strategy: SubscriptionStrategyDraft;
};
type CandidateVariant = {
  key: string;
  candidate: Candidate;
  candidates: Candidate[];
  sourceNames: string[];
  latestCreatedAt?: string | null;
};
type CandidateEpisodeGroup = {
  key: string;
  label: string;
  candidateCount: number;
  variants: CandidateVariant[];
};

const SUBSCRIPTIONS_PAGE_SIZE = 12;

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
  const [subscriptionPage, setSubscriptionPage] = useState(1);
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
  const [candidateLoading, setCandidateLoading] = useState(true);
  const [candidateError, setCandidateError] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [pendingSubscription, setPendingSubscription] = useState<PendingSubscription | null>(null);
  const [subscriptionSubmitting, setSubscriptionSubmitting] = useState(false);
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
  const subscriptionTotalPages = Math.max(
    1,
    Math.ceil(visibleSubscriptions.length / SUBSCRIPTIONS_PAGE_SIZE),
  );
  const currentSubscriptionPage = Math.min(subscriptionPage, subscriptionTotalPages);
  const pagedSubscriptions = useMemo(() => {
    const start = (currentSubscriptionPage - 1) * SUBSCRIPTIONS_PAGE_SIZE;
    return visibleSubscriptions.slice(start, start + SUBSCRIPTIONS_PAGE_SIZE);
  }, [currentSubscriptionPage, visibleSubscriptions]);
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
        if (candidateFilter === "BATCH") {
          return group.candidates.some(candidateIsBatch);
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
  const selectedGroup = useMemo(
    () => visibleGroups.find((group) => group.id === selectedGroupId) ?? visibleGroups[0] ?? null,
    [selectedGroupId, visibleGroups],
  );
  const subscriptionPreview = useMemo(
    () =>
      pendingSubscription
        ? buildSubscriptionPreview(
            pendingSubscription.group,
            pendingSubscription.candidate,
            pendingSubscription.strategy,
          )
        : null,
    [pendingSubscription],
  );

  const loadBaseData = useCallback(async () => {
    try {
      const [rssResponse, subscriptionsResponse] = await Promise.all([
        fetch("/api/rss-sources"),
        fetch("/api/subscriptions"),
      ]);
      if (!rssResponse.ok || !subscriptionsResponse.ok) {
        throw new Error(t.subscriptionsLoadError);
      }
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
      setRssSources(rssBody.sources);
      setQueueRuns(rssBody.queueStatus ?? { lastFetchRun: null, lastGroupRun: null });
      setSubscriptions(subscriptionsBody.subscriptions);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t.subscriptionsLoadError);
    } finally {
      setLoading(false);
    }
  }, [t.subscriptionsLoadError]);

  const loadCandidates = useCallback(async (signal?: AbortSignal) => {
    setCandidateLoading(true);
    try {
      const params = subscriptionCandidateParams({
        filter: candidateFilter,
        mediaType: candidateMediaType,
        page: candidatePage,
        query: candidateQuery,
        sort: candidateSort,
        status: candidateStatus,
      });
      const response = await fetch(`/api/subscription-candidates?${params}`, { signal });
      if (!response.ok) {
        throw new Error(t.subscriptionsLoadError);
      }
      const body = (await response.json()) as {
        groups: CandidateGroup[];
        stats?: CandidateStats;
        page?: CandidatePage;
      };
      setGroups(body.groups);
      setCandidateStats(
        body.stats ?? {
          totalGroups: body.groups.length,
          filteredGroups: body.groups.length,
          activeGroups: body.groups.filter((group) => group.candidates.length > 0).length,
          subscribedGroups: 0,
          emptyGroups: body.groups.filter((group) => group.candidates.length === 0).length,
          reviewGroups: body.groups.filter((group) => group.reviewRequired).length,
          ungroupedCandidates: 0,
        },
      );
      setCandidatePageInfo(
        body.page ?? {
          page: candidatePage,
          pageSize: body.groups.length,
          total: body.groups.length,
          totalPages: 1,
          hasNext: false,
          hasPrevious: candidatePage > 1,
        },
      );
      setCandidateError("");
    } catch (loadError) {
      if (signal?.aborted) {
        return;
      }
      setCandidateError(loadError instanceof Error ? loadError.message : t.subscriptionsLoadError);
    } finally {
      if (!signal?.aborted) {
        setCandidateLoading(false);
      }
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

  const refreshData = useCallback(async () => {
    await Promise.all([loadBaseData(), loadCandidates()]);
  }, [loadBaseData, loadCandidates]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadBaseData(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadBaseData]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => void loadCandidates(controller.signal),
      candidateQuery ? 250 : 0,
    );
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [candidateQuery, loadCandidates]);

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
    await refreshData();
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
    await refreshData();
  }

  async function toggleRssSource(source: RssSource) {
    const response = await fetch(`/api/rss-sources/${source.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !source.enabled }),
    });
    if (response.ok) {
      await refreshData();
    }
  }

  async function deleteRssSource(source: RssSource) {
    const response = await fetch(`/api/rss-sources/${source.id}`, {
      method: "DELETE",
    });
    if (response.ok) {
      await refreshData();
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
    await refreshData();
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
    await refreshData();
  }

  function openSubscriptionDialog(group: CandidateGroup, candidate?: Candidate) {
    setStatus("");
    setError("");
    setPendingSubscription({
      group,
      candidate,
      strategy: buildSubscriptionStrategy(group, candidate),
    });
  }

  function updatePendingStrategy(patch: Partial<SubscriptionStrategyDraft>) {
    setPendingSubscription((current) =>
      current
        ? {
            ...current,
            strategy: {
              ...normalizeSubscriptionStrategyDraft({
                ...current.strategy,
                ...patch,
              }),
              autoDownload: current.candidate ? (patch.autoDownload ?? current.strategy.autoDownload) : false,
            },
          }
        : current,
    );
  }

  async function submitPendingSubscription() {
    if (!pendingSubscription || subscriptionSubmitting) {
      return;
    }
    setStatus("");
    setError("");
    setSubscriptionSubmitting(true);
    const { group, candidate, strategy } = pendingSubscription;
    try {
      const response = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: candidate?.id,
          candidateGroupId: group.id,
          seasonMode: strategy.seasonMode,
          seasonNumber: strategy.seasonNumber,
          episodeMode: strategy.episodeMode,
          episodeStart: strategy.episodeStart,
          episodeEnd: strategy.episodeEnd,
          batchPolicy: strategy.batchPolicy,
          preferredGroup: candidatePreferredGroup(candidate) ?? undefined,
          preferredResolution: candidate?.resolution ?? undefined,
          preferredCodec: candidate?.codec ?? undefined,
          preferredAudio: candidate?.audio ?? undefined,
          preferredSubtitleLanguage: candidate?.subtitleLanguage ?? undefined,
          preferredReleaseProfile: candidate?.releaseProfile ?? undefined,
          preferredSourceKind: candidate?.sourceKind ?? undefined,
          preferredVariantKey: candidate?.variantKey ?? undefined,
          autoDownload: strategy.autoDownload,
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
        setPendingSubscription(null);
        await refreshData();
      } else {
        const body = await response.json().catch(() => null);
        setError(body?.message || t.subscriptionCreateError);
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t.subscriptionCreateError);
    } finally {
      setSubscriptionSubmitting(false);
    }
  }

  async function downloadCandidate(candidate: Candidate) {
    const response = await fetch(`/api/release-candidates/${candidate.id}/download`, {
      method: "POST",
    });
    if (response.ok) {
      setStatus(t.downloadCreated);
      await refreshData();
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
      await refreshData();
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
              onChange={(event) => {
                setSubscriptionPage(1);
                setSubscriptionQuery(event.target.value);
              }}
              placeholder={t.filterSubscriptions}
              value={subscriptionQuery}
            />
          </label>
          <select
            aria-label={t.mediaType}
            onChange={(event) => {
              setSubscriptionPage(1);
              setSubscriptionMediaType(event.target.value as MediaTypeFilter);
            }}
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
            onChange={(event) => {
              setSubscriptionPage(1);
              setSubscriptionMode(event.target.value as SubscriptionModeFilter);
            }}
            value={subscriptionMode}
          >
            <option value="ALL">{t.subscriptionModeAll}</option>
            <option value="AUTO">{t.subscriptionModeAuto}</option>
            <option value="MANUAL">{t.subscriptionModeManual}</option>
          </select>
        </div>
        <div className="subscription-table">
          {subscriptions.length === 0 ? (
            <div className="empty-panel">{t.noActiveSubscriptions}</div>
          ) : visibleSubscriptions.length === 0 ? (
            <div className="empty-panel">{t.noMatchingResults}</div>
          ) : (
            pagedSubscriptions.map((subscription) => (
              <article className="subscription-table-row" key={subscription.id}>
                <div className="subscription-table-title">
                  <span className={subscription.autoDownload ? "candidate-policy active" : "candidate-policy"}>
                    {subscription.autoDownload ? t.subscriptionModeAuto : t.subscriptionModeManual}
                  </span>
                  <div>
                    <h3>{subscription.title}</h3>
                    <p>
                      {formatMediaType(subscription.mediaType, t)}
                      {subscription.candidateGroup?.displayTitle &&
                      subscription.candidateGroup.displayTitle !== subscription.title
                        ? ` · ${subscription.candidateGroup.displayTitle}`
                        : ""}
                    </p>
                  </div>
                </div>
                <div className="subscription-table-cell">
                  <span>{t.strategySeasonMode}</span>
                  <strong>{formatSeasonPolicy(subscription, t, locale)}</strong>
                </div>
                <div className="subscription-table-cell">
                  <span>{t.strategyEpisodeMode}</span>
                  <strong>{formatEpisodePolicy(subscription, t, locale)}</strong>
                </div>
                <div className="subscription-table-cell subscription-table-version">
                  <span>{t.strategySelectedVersion}</span>
                  <strong>
                    {formatSubscriptionPreferences(subscription) || formatBatchPolicy(subscription.batchPolicy, t)}
                  </strong>
                </div>
                <div className="subscription-table-actions">
                  <button
                    aria-label={t.cancelSubscription}
                    className="danger-button icon-button"
                    onClick={() => void cancelSubscription(subscription)}
                    title={t.cancelSubscription}
                    type="button"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
        {subscriptionTotalPages > 1 ? (
          <div className="candidate-pagination subscription-pagination">
            <span>
              {t.queuePage} {currentSubscriptionPage} / {subscriptionTotalPages} · {t.queueShowing}{" "}
              {(currentSubscriptionPage - 1) * SUBSCRIPTIONS_PAGE_SIZE + 1}-
              {Math.min(currentSubscriptionPage * SUBSCRIPTIONS_PAGE_SIZE, visibleSubscriptions.length)}
              {" / "}{visibleSubscriptions.length}
            </span>
            <div>
              <button
                disabled={currentSubscriptionPage <= 1}
                onClick={() => setSubscriptionPage((page) => Math.max(1, page - 1))}
                type="button"
              >
                {t.queuePrevious}
              </button>
              <button
                disabled={currentSubscriptionPage >= subscriptionTotalPages}
                onClick={() => setSubscriptionPage((page) => Math.min(subscriptionTotalPages, page + 1))}
                type="button"
              >
                {t.queueNext}
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section aria-busy={candidateLoading} className="candidate-board">
        <div className="candidate-board-heading">
          <div>
            <h2>{t.subscriptionQueue}</h2>
            <p>
              {visibleGroups.length} / {candidatePageInfo.total} {t.titles} ·{" "}
              {groupsWithVersions} {t.withVersions} ·{" "}
              {candidateStats.ungroupedCandidates} {t.ungroupedCandidates}
            </p>
            {candidateLoading ? (
              <span className="candidate-loading-status">
                <Loader2 size={13} />
                {t.loading}
              </span>
            ) : null}
          </div>
          <div className="candidate-board-tools">
            <div className="filter-tabs">
              {[
                ["ACTIVE", t.currentCandidates],
                ["BATCH", t.batchCandidates],
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
        {candidateError ? <div className="settings-alert candidate-load-error">{candidateError}</div> : null}
        {candidateLoading && groups.length === 0 ? (
          <div className="candidate-initial-loading">
            <Loader2 size={16} />
            {t.loading}
          </div>
        ) : candidateError && groups.length === 0 ? null : visibleGroups.length === 0 ? (
          <div className="empty-panel">
            {groups.length === 0 ? t.noCandidates : t.noMatchingResults}
          </div>
        ) : selectedGroup ? (
          <div className="subscription-workbench">
            <div className="queue-master-list">
              {visibleGroups.map((group) => {
                const groupSubscriptions = subscriptions.filter(
                  (subscription) => subscription.candidateGroupId === group.id,
                );
                const hasAnySubscription = groupSubscriptions.length > 0;
                const freshness = summarizeCandidateGroupFreshness(group);
                const queueStatus = group.queueStatus ?? fallbackQueueStatus(group, hasAnySubscription);

                return (
                  <button
                    className={selectedGroup.id === group.id ? "queue-master-item active" : "queue-master-item"}
                    key={group.id}
                    onClick={() => setSelectedGroupId(group.id)}
                    type="button"
                  >
                    <span className={hasAnySubscription ? "candidate-policy active" : "candidate-policy"}>
                      {formatQueueState(queueStatus.state, t)}
                    </span>
                    <strong>{group.displayTitle}</strong>
                    <small>
                      {formatMediaType(group.mediaType, t)} · {group._count.candidates} {t.candidates} ·{" "}
                      {Math.round(group.confidence * 100)}%
                    </small>
                    <small>
                      {group.reviewRequired ? t.needsReview : formatQueueReason(queueStatus.reason, t)}
                    </small>
                    <span className="queue-master-meta">
                      {freshness ? formatCandidateFreshness(freshness, locale, t) : t.latestCandidate}
                      {group.sourceSummary
                        ? ` · ${formatCandidateSourceSummary(group.sourceSummary, locale, t)}`
                        : ""}
                    </span>
                  </button>
                );
              })}
            </div>
            {(() => {
              const group = selectedGroup;
              const groupSubscriptions = subscriptions.filter(
                (subscription) => subscription.candidateGroupId === group.id,
              );
              const hasAnySubscription = groupSubscriptions.length > 0;
              const hasFutureOnlySubscription = groupSubscriptions.some((subscription) =>
                subscriptionMatchesGroupFutureRule(group, subscription),
              );
              const freshness = summarizeCandidateGroupFreshness(group);
              const queueStatus = group.queueStatus ?? fallbackQueueStatus(group, hasAnySubscription);

              return (
                <article className="candidate-group queue-detail-panel">
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
                      <span className={hasAnySubscription ? "candidate-policy active" : "candidate-policy"}>
                        {formatQueueState(queueStatus.state, t)}
                      </span>
                      {!hasFutureOnlySubscription ? (
                        <button onClick={() => openSubscriptionDialog(group)} type="button">
                          <Plus size={14} />
                          {t.futureOnlySubscribe}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="queue-detail-status">
                    <span>{formatQueueReason(queueStatus.reason, t)}</span>
                    {group.aiSummary ? <span>{group.aiSummary}</span> : null}
                  </div>
                  {groupSubscriptions.length > 0 ? (
                    <div className="queue-subscription-summary">
                      {groupSubscriptions.map((subscription) => (
                        <span key={subscription.id}>
                          {subscription.autoDownload ? t.subscriptionModeAuto : t.subscriptionModeManual}
                          {formatSubscriptionPolicy(subscription, t, locale)
                            ? ` · ${formatSubscriptionPolicy(subscription, t, locale)}`
                            : ""}
                        </span>
                      ))}
                    </div>
                  ) : null}
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
                              {episode.variants.length} {t.uniqueVariants} ·{" "}
                              {episode.candidateCount} {t.rssItems}
                            </small>
                          </div>
                          {episode.variants.map((variant) => {
                            const candidate = variant.candidate;
                            const isSubscribed = variant.candidates.some((variantCandidate) =>
                              groupSubscriptions.some((subscription) =>
                                candidateMatchesSubscription(variantCandidate, subscription),
                              ),
                            );
                            const hasOtherSubscription = hasAnySubscription && !isSubscribed;

                            return (
                              <div className="candidate-row" key={variant.key}>
                                <div>
                                  <strong>{candidate.rawTitle}</strong>
                                  <span className="candidate-row-meta">
                                    {formatCandidateMeta(candidate, locale)}
                                  </span>
                                  <span className="candidate-row-sources">
                                    {formatVariantSourceSummary(variant, locale, t)}
                                  </span>
                                </div>
                                <div className="candidate-actions">
                                  <button
                                    disabled={isSubscribed}
                                    onClick={() => openSubscriptionDialog(group, candidate)}
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
            })()}
          </div>
        ) : null}
        {!candidateLoading || groups.length > 0 ? (
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
        ) : null}
      </section>
      {pendingSubscription ? (
        <div
          className="strategy-dialog-backdrop"
          onMouseDown={() => {
            if (!subscriptionSubmitting) {
              setPendingSubscription(null);
            }
          }}
          role="presentation"
        >
          <section
            aria-labelledby="subscription-strategy-dialog-title"
            aria-modal="true"
            className="strategy-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="strategy-dialog-heading">
              <div>
                <h2 id="subscription-strategy-dialog-title">{t.subscriptionStrategyDialogTitle}</h2>
                <p>{t.subscriptionStrategyDialogDescription}</p>
              </div>
              <button
                aria-label={t.strategyCancel}
                className="strategy-dialog-close"
                disabled={subscriptionSubmitting}
                onClick={() => setPendingSubscription(null)}
                type="button"
              >
                <X size={16} />
              </button>
            </div>

            <div className="strategy-summary-grid">
              <StrategySummaryItem label={t.strategyTitle} value={pendingSubscription.group.displayTitle} />
              <StrategySummaryItem
                label={t.mediaType}
                value={formatMediaType(pendingSubscription.group.mediaType, t)}
              />
              <StrategySummaryItem
                label={t.strategySelectedVersion}
                value={
                  pendingSubscription.candidate
                    ? formatCandidateMeta(pendingSubscription.candidate, locale) || pendingSubscription.candidate.rawTitle
                    : t.strategyFutureOnlyMode
                }
              />
              <StrategySummaryItem
                label={t.strategyFallback}
                value={t.strategyFallbackManualReview}
              />
            </div>

            <div className="strategy-form-grid">
              <label>
                <span>{t.strategySeasonMode}</span>
                <select
                  disabled={subscriptionSubmitting}
                  onChange={(event) =>
                    updatePendingStrategy({
                      seasonMode: event.target.value as SubscriptionStrategyDraft["seasonMode"],
                    })
                  }
                  value={pendingSubscription.strategy.seasonMode}
                >
                  <option value="specific">{t.strategySeasonSpecific}</option>
                  <option value="latest">{t.strategySeasonLatest}</option>
                  <option value="unknown_review">{t.strategySeasonUnknown}</option>
                </select>
              </label>
              <label>
                <span>{t.strategySeasonNumber}</span>
                <input
                  disabled={subscriptionSubmitting || pendingSubscription.strategy.seasonMode !== "specific"}
                  min={1}
                  onChange={(event) =>
                    updatePendingStrategy({
                      seasonNumber: parseOptionalPositiveNumber(event.target.value),
                    })
                  }
                  type="number"
                  value={pendingSubscription.strategy.seasonNumber ?? ""}
                />
              </label>
              <label>
                <span>{t.strategyEpisodeMode}</span>
                <select
                  disabled={subscriptionSubmitting}
                  onChange={(event) =>
                    updatePendingStrategy({
                      episodeMode: event.target.value as SubscriptionStrategyDraft["episodeMode"],
                    })
                  }
                  value={pendingSubscription.strategy.episodeMode}
                >
                  <option value="future_only">{t.strategyEpisodeFuture}</option>
                  <option value="missing_only">{t.strategyEpisodeMissingOnly}</option>
                  <option value="range">{t.strategyEpisodeRange}</option>
                  <option value="all">{t.strategyEpisodeAll}</option>
                </select>
              </label>
              <label>
                <span>{t.strategyEpisodeStart}</span>
                <input
                  disabled={
                    subscriptionSubmitting ||
                    (pendingSubscription.strategy.episodeMode !== "future_only" &&
                      pendingSubscription.strategy.episodeMode !== "range")
                  }
                  min={1}
                  onChange={(event) =>
                    updatePendingStrategy({
                      episodeStart: parseOptionalPositiveNumber(event.target.value),
                    })
                  }
                  type="number"
                  value={pendingSubscription.strategy.episodeStart ?? ""}
                />
              </label>
              <label>
                <span>{t.strategyEpisodeEnd}</span>
                <input
                  disabled={subscriptionSubmitting || pendingSubscription.strategy.episodeMode !== "range"}
                  min={1}
                  onChange={(event) =>
                    updatePendingStrategy({
                      episodeEnd: parseOptionalPositiveNumber(event.target.value),
                    })
                  }
                  type="number"
                  value={pendingSubscription.strategy.episodeEnd ?? ""}
                />
              </label>
              <label>
                <span>{t.strategyBatchPolicy}</span>
                <select
                  disabled={subscriptionSubmitting}
                  onChange={(event) =>
                    updatePendingStrategy({
                      batchPolicy: event.target.value as SubscriptionStrategyDraft["batchPolicy"],
                    })
                  }
                  value={pendingSubscription.strategy.batchPolicy}
                >
                  <option value="review">{t.strategyBatchReview}</option>
                  <option value="reject">{t.strategyBatchReject}</option>
                  <option value="allow">{t.strategyBatchAllow}</option>
                </select>
              </label>
            </div>

            <label className={pendingSubscription.candidate ? "strategy-toggle" : "strategy-toggle disabled"}>
              <input
                checked={pendingSubscription.strategy.autoDownload}
                disabled={subscriptionSubmitting || !pendingSubscription.candidate}
                onChange={(event) =>
                  updatePendingStrategy({
                    autoDownload: event.target.checked,
                  })
                }
                type="checkbox"
              />
              <span>{t.strategyAutoDownload}</span>
            </label>

            <div className="strategy-preview">
              <div className="strategy-preview-heading">
                <h3>{t.strategyPreviewTitle}</h3>
                {subscriptionPreview?.selection.candidate ? (
                  <span>
                    {t.strategyPreviewSelected}: {subscriptionPreview.selection.candidate.rawTitle}
                  </span>
                ) : (
                  <span>{t.strategyNoCandidatePreview}</span>
                )}
              </div>
              {subscriptionPreview && subscriptionPreview.evaluations.length > 0 ? (
                <div className="strategy-preview-list">
                  {subscriptionPreview.evaluations.slice(0, 6).map((evaluation) => (
                    <StrategyEvaluationRow
                      evaluation={evaluation}
                      isSelected={subscriptionPreview.selection.candidate?.id === evaluation.candidate.id}
                      key={evaluation.candidate.id}
                      locale={locale}
                      t={t}
                    />
                  ))}
                </div>
              ) : (
                <p>{t.strategyNoCandidatePreview}</p>
              )}
            </div>

            <div className="strategy-dialog-actions">
              <button
                disabled={subscriptionSubmitting}
                onClick={() => setPendingSubscription(null)}
                type="button"
              >
                {t.strategyCancel}
              </button>
              <button
                className="strategy-confirm-button"
                disabled={subscriptionSubmitting}
                onClick={() => void submitPendingSubscription()}
                type="button"
              >
                {subscriptionSubmitting ? <Loader2 size={14} /> : <CheckCircle2 size={14} />}
                {t.strategyConfirm}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function StrategySummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StrategyEvaluationRow({
  evaluation,
  isSelected,
  locale,
  t,
}: {
  evaluation: SubscriptionCandidateEvaluation;
  isSelected: boolean;
  locale: Locale;
  t: ReturnType<typeof getMessages>;
}) {
  const state = !evaluation.eligible
    ? "rejected"
    : evaluation.needsReview
      ? "review"
      : "eligible";
  const stateLabel = !evaluation.eligible
    ? t.strategyPreviewRejected
    : evaluation.needsReview
      ? t.strategyPreviewReview
      : t.strategyPreviewEligible;

  return (
    <article className={`strategy-evaluation-row ${state}`}>
      <div className="strategy-evaluation-main">
        <div className="strategy-evaluation-title">
          {state === "eligible" ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
          <strong>{evaluation.candidate.rawTitle}</strong>
        </div>
        <span>
          {formatCandidateMetaFromStrategyCandidate(evaluation.candidate, locale)}
        </span>
        <p>{formatEvaluationDetail(evaluation, t)}</p>
      </div>
      <div className="strategy-evaluation-side">
        {isSelected ? <span className="strategy-selected-pill">{t.strategyEvaluationSelected}</span> : null}
        <span>{stateLabel}</span>
        <small>{t.strategyScore}: {evaluation.score}</small>
      </div>
    </article>
  );
}

function buildSubscriptionPreview(
  group: CandidateGroup,
  candidate: Candidate | undefined,
  draft: SubscriptionStrategyDraft,
) {
  const strategy = toEvaluationStrategy(draft, candidate);
  const strategyCandidates = groupCandidatesByEpisode(group.candidates)
    .flatMap((episode) => episode.variants.map((variant) => variant.candidate))
    .map(toStrategyCandidate);
  const selection = selectSubscriptionCandidate(strategyCandidates, strategy);
  const evaluations = evaluateSubscriptionCandidates(strategyCandidates, strategy)
    .map((evaluation) =>
      selection.evaluation?.candidate.id === evaluation.candidate.id
        ? {
            ...evaluation,
            needsReview: selection.needsReview,
            reasons: selection.evaluation.reasons,
          }
        : evaluation,
    )
    .sort((a, b) => {
      const selectedSort =
        Number(selection.candidate?.id === b.candidate.id) -
        Number(selection.candidate?.id === a.candidate.id);
      if (selectedSort !== 0) {
        return selectedSort;
      }
      return (
        Number(b.eligible) - Number(a.eligible) ||
        b.score - a.score ||
        b.candidate.createdAt.getTime() - a.candidate.createdAt.getTime()
      );
    });
  return { evaluations, selection };
}

function toEvaluationStrategy(
  draft: SubscriptionStrategyDraft,
  candidate?: Candidate,
): SubscriptionStrategy {
  return {
    seasonMode: draft.seasonMode,
    seasonNumber: draft.seasonNumber,
    episodeMode: draft.episodeMode,
    episodeStart: draft.episodeStart,
    episodeEnd: draft.episodeEnd,
    batchPolicy: draft.batchPolicy,
    preferredGroup: candidatePreferredGroup(candidate),
    preferredResolution: candidate?.resolution ?? null,
    preferredCodec: candidate?.codec ?? null,
    preferredAudio: candidate?.audio ?? null,
    preferredSubtitleLanguage: candidate?.subtitleLanguage ?? null,
    preferredReleaseProfile: candidate?.releaseProfile ?? null,
    preferredSourceKind: candidate?.sourceKind ?? null,
    preferredVariantKey: candidate?.variantKey ?? null,
    fallbackPolicy: "manual_review",
  };
}

function toStrategyCandidate(candidate: Candidate): StrategyCandidate {
  const createdAt = candidate.createdAt ? new Date(candidate.createdAt) : new Date(0);
  return {
    id: candidate.id,
    mediaType: candidate.mediaType,
    rawTitle: candidate.rawTitle,
    season: candidate.season ?? null,
    episodeNumber: candidate.episodeNumber ?? null,
    subtitleGroup: candidate.subtitleGroup ?? null,
    resolution: candidate.resolution ?? null,
    codec: candidate.codec ?? null,
    audio: candidate.audio ?? null,
    subtitleLanguage: candidate.subtitleLanguage ?? null,
    releaseProfile: candidate.releaseProfile ?? null,
    sourceKind: candidate.sourceKind ?? null,
    variantKey: candidate.variantKey ?? null,
    createdAt: Number.isFinite(createdAt.getTime()) ? createdAt : new Date(0),
  };
}

function normalizeSubscriptionStrategyDraft(
  draft: SubscriptionStrategyDraft,
): SubscriptionStrategyDraft {
  const next = { ...draft };
  if (next.seasonMode !== "specific") {
    next.seasonNumber = null;
  }
  if (next.episodeMode === "all" || next.episodeMode === "missing_only") {
    next.episodeStart = null;
    next.episodeEnd = null;
  }
  if (next.episodeMode === "future_only") {
    next.episodeEnd = null;
  }
  if (
    next.episodeMode === "range" &&
    next.episodeStart !== null &&
    next.episodeEnd !== null &&
    next.episodeEnd < next.episodeStart
  ) {
    next.episodeEnd = next.episodeStart;
  }
  return next;
}

function parseOptionalPositiveNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatCandidateMetaFromStrategyCandidate(candidate: StrategyCandidate, locale: Locale) {
  return formatCandidateMeta(
    {
      id: candidate.id,
      mediaType: (candidate.mediaType as MediaType | null) ?? "ANIME",
      rawTitle: candidate.rawTitle ?? "",
      season: candidate.season,
      episodeNumber: candidate.episodeNumber,
      subtitleGroup: candidate.subtitleGroup,
      resolution: candidate.resolution,
      codec: candidate.codec,
      audio: candidate.audio,
      subtitleLanguage: candidate.subtitleLanguage,
      releaseProfile: candidate.releaseProfile,
      sourceKind: candidate.sourceKind,
      variantKey: candidate.variantKey,
      status: "",
    },
    locale,
  );
}

function formatEvaluationDetail(
  evaluation: SubscriptionCandidateEvaluation,
  t: ReturnType<typeof getMessages>,
) {
  if (!evaluation.eligible && evaluation.rejectedBy.length > 0) {
    return `${t.strategyRejectedBy}: ${evaluation.rejectedBy.map((key) => formatStrategyKey(key, t)).join(" · ")}`;
  }
  if (evaluation.needsReview) {
    return evaluation.reasons.length > 0
      ? `${t.strategyNeedsReviewReason}: ${evaluation.reasons[0]}`
      : t.strategyNeedsReviewReason;
  }
  if (evaluation.matchedPreferences.length > 0) {
    return `${t.strategyMatchedPreferences}: ${evaluation.matchedPreferences
      .map((key) => formatStrategyKey(key, t))
      .join(" · ")}`;
  }
  return t.strategyNoEvaluationReasons;
}

function formatStrategyKey(key: string, t: ReturnType<typeof getMessages>) {
  switch (key) {
    case "preferredVariantKey":
      return t.strategyPreferredVariant;
    case "preferredGroup":
      return t.strategyPreferredGroup;
    case "preferredSubtitleLanguage":
      return t.strategyPreferredSubtitleLanguage;
    case "preferredResolution":
      return t.strategyPreferredResolution;
    case "preferredCodec":
      return t.strategyPreferredCodec;
    case "preferredAudio":
      return t.strategyPreferredAudio;
    case "preferredReleaseProfile":
      return t.strategyPreferredReleaseProfile;
    case "preferredSourceKind":
      return t.strategyPreferredSourceKind;
    case "batchPolicy":
      return t.strategyBatchPolicy;
    case "seasonNumber":
      return t.strategySeasonNumber;
    case "episodeStart":
      return t.strategyEpisodeStart;
    case "episodeEnd":
      return t.strategyEpisodeEnd;
    default:
      return key;
  }
}

function groupCandidatesByEpisode(candidates: Candidate[]): CandidateEpisodeGroup[] {
  const grouped = new Map<string, CandidateEpisodeGroup & { variantMap: Map<string, Candidate[]> }>();

  for (const candidate of candidates) {
    const label =
      candidate.episodeNumber === null || candidate.episodeNumber === undefined
        ? "-"
        : String(candidate.episodeNumber).padStart(2, "0");
    const key = label === "-" ? `unknown-${candidate.id}` : label;
    const group =
      grouped.get(key) ??
      { key, label, candidateCount: 0, variants: [], variantMap: new Map<string, Candidate[]>() };
    const variantKey = candidateVariantKey(candidate);
    const variantCandidates = group.variantMap.get(variantKey) ?? [];
    variantCandidates.push(candidate);
    group.variantMap.set(variantKey, variantCandidates);
    group.candidateCount += 1;
    grouped.set(key, group);
  }

  return [...grouped.values()].map((group) => {
    const variants = [...group.variantMap.entries()]
      .map(([key, variantCandidates]) => buildCandidateVariant(key, variantCandidates))
      .sort((a, b) => candidateTimeValue(b.candidate.createdAt) - candidateTimeValue(a.candidate.createdAt));
    return {
      key: group.key,
      label: group.label,
      candidateCount: group.candidateCount,
      variants,
    };
  });
}

function buildCandidateVariant(key: string, candidates: Candidate[]): CandidateVariant {
  const sorted = [...candidates].sort(
    (a, b) => candidateTimeValue(b.createdAt) - candidateTimeValue(a.createdAt),
  );
  const candidate = sorted[0];
  return {
    key,
    candidate,
    candidates: sorted,
    sourceNames: uniqueSourceNames(sorted),
    latestCreatedAt: candidate.createdAt ?? null,
  };
}

function candidateVariantKey(candidate: Candidate) {
  if (candidate.variantKey) {
    return `variant:${candidate.variantKey}`;
  }
  return [
    candidate.subtitleGroup,
    normalizeMetaAtom(candidate.releaseProfile ?? ""),
    candidate.subtitleLanguage,
    candidate.sourceKind,
    normalizeMetaAtom(candidate.resolution ?? ""),
    normalizeMetaAtom(candidate.codec ?? ""),
    normalizeMetaAtom(candidate.audio ?? ""),
    candidate.episodeNumber ?? "unknown",
    normalizeMetaAtom(candidate.rawTitle),
  ]
    .filter(Boolean)
    .join("|");
}

function uniqueSourceNames(candidates: Candidate[]) {
  const names = new Map<string, string>();
  for (const candidate of candidates) {
    const name = candidate.rssItem?.source?.name ?? candidate.sourceKind ?? candidate.rssItem?.origin ?? null;
    if (name) {
      names.set(name.toLowerCase(), name);
    }
  }
  return [...names.values()];
}

function candidateTimeValue(value?: string | null) {
  if (!value) {
    return 0;
  }
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function formatVariantSourceSummary(
  variant: CandidateVariant,
  locale: Locale,
  t: ReturnType<typeof getMessages>,
) {
  const sources = variant.sourceNames.slice(0, 3).join(", ");
  const sourceSummary = sources ? `${t.candidateSources}: ${sources}` : t.candidateSources;
  const duplicateSummary =
    variant.candidates.length > 1
      ? ` · ${variant.candidates.length} ${t.rssItems}`
      : "";
  const latest = variant.latestCreatedAt
    ? ` · ${t.latestCandidate}: ${formatShortDate(variant.latestCreatedAt, locale)}`
    : "";
  return `${sourceSummary}${duplicateSummary}${latest}`;
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

function formatSubscriptionPolicy(
  subscription: Subscription,
  t: ReturnType<typeof getMessages>,
  locale: Locale,
) {
  return [
    formatSubscriptionScope(subscription, t, locale),
    formatBatchPolicy(subscription.batchPolicy, t),
    ...subscriptionPreferenceParts(subscription),
    subscription.autoDownload ? t.subscriptionModeAuto : t.subscriptionModeManual,
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatSeasonPolicy(
  subscription: Subscription,
  t: ReturnType<typeof getMessages>,
  locale: Locale,
) {
  return formatSeasonScope(subscriptionStrategyView(subscription), t, locale);
}

function formatEpisodePolicy(
  subscription: Subscription,
  t: ReturnType<typeof getMessages>,
  locale: Locale,
) {
  return formatEpisodeScope(subscriptionStrategyView(subscription), t, locale);
}

function formatSubscriptionPreferences(subscription: Subscription) {
  return subscriptionPreferenceParts(subscription).join(" · ");
}

function subscriptionPreferenceParts(subscription: Subscription) {
  return uniqueDisplayParts([
    subscription.preferredGroup,
    subscription.preferredReleaseProfile,
    subscription.preferredSubtitleLanguage,
    subscription.preferredSourceKind,
    subscription.preferredResolution,
    subscription.preferredCodec,
    subscription.preferredAudio,
  ]);
}

function uniqueDisplayParts(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const seenAtoms = new Set<string>();
  return values.flatMap((value) => {
    const text = value?.trim();
    if (!text) {
      return [];
    }
    const key = text.toLocaleLowerCase();
    if (seen.has(key)) {
      return [];
    }
    const atoms = key
      .split(/\s*(?:\/|／|·|\||｜|,|，)\s*/)
      .map((atom) => atom.trim())
      .filter(Boolean);
    if (atoms.length > 0 && atoms.every((atom) => seenAtoms.has(atom))) {
      return [];
    }
    seen.add(key);
    atoms.forEach((atom) => seenAtoms.add(atom));
    return [text];
  });
}

function buildSubscriptionStrategy(group: CandidateGroup, candidate?: Candidate): SubscriptionStrategyDraft {
  const seasonNumber = candidate?.season ?? group.season ?? null;
  return {
    title: group.displayTitle,
    seasonMode: seasonNumber ? "specific" : "unknown_review",
    seasonNumber,
    episodeMode: "future_only",
    episodeStart: candidate?.episodeNumber ?? null,
    episodeEnd: null,
    batchPolicy: "review",
    autoDownload: Boolean(candidate),
  };
}

function formatSubscriptionScope(
  subscription: Subscription,
  t: ReturnType<typeof getMessages>,
  locale: Locale,
) {
  const strategy = subscriptionStrategyView(subscription);
  return `${formatSeasonScope(strategy, t, locale)} · ${formatEpisodeScope(strategy, t, locale)}`;
}

function subscriptionStrategyView(subscription: Subscription) {
  return {
    title: subscription.title,
    seasonMode: subscription.seasonMode === "latest" || subscription.seasonMode === "specific"
      ? subscription.seasonMode
      : "unknown_review",
    seasonNumber: subscription.seasonNumber ?? null,
    episodeMode:
      subscription.episodeMode === "missing_only" ||
      subscription.episodeMode === "range" ||
      subscription.episodeMode === "all"
        ? subscription.episodeMode
        : "future_only",
    episodeStart: subscription.episodeStart ?? null,
    episodeEnd: subscription.episodeEnd ?? null,
    batchPolicy:
      subscription.batchPolicy === "reject" || subscription.batchPolicy === "allow"
        ? subscription.batchPolicy
        : "review",
    autoDownload: subscription.autoDownload,
  } satisfies SubscriptionStrategyDraft;
}

function formatSeasonScope(
  strategy: Pick<SubscriptionStrategyDraft, "seasonMode" | "seasonNumber">,
  t: ReturnType<typeof getMessages>,
  locale?: Locale,
) {
  if (strategy.seasonMode === "latest") {
    return t.strategySeasonLatest;
  }
  if (strategy.seasonMode === "specific" && strategy.seasonNumber) {
    if (locale !== "en") {
      return `第 ${String(strategy.seasonNumber).padStart(2, "0")} 季`;
    }
    return `${t.strategySeasonSpecific} ${String(strategy.seasonNumber).padStart(2, "0")}`;
  }
  return t.strategySeasonUnknown;
}

function formatEpisodeScope(
  strategy: Pick<SubscriptionStrategyDraft, "episodeMode" | "episodeStart" | "episodeEnd">,
  t: ReturnType<typeof getMessages>,
  locale?: Locale,
) {
  if (strategy.episodeMode === "all") {
    return t.strategyEpisodeAll;
  }
  if (strategy.episodeMode === "missing_only") {
    return t.strategyEpisodeMissingOnly;
  }
  if (strategy.episodeMode === "range") {
    if (locale !== "en") {
      return `第 ${strategy.episodeStart ?? "?"}-${strategy.episodeEnd ?? "?"} 集`;
    }
    return `${t.strategyEpisodeRange} ${strategy.episodeStart ?? "?"}-${strategy.episodeEnd ?? "?"}`;
  }
  if (strategy.episodeStart) {
    if (locale !== "en") {
      return `从第 ${strategy.episodeStart} 集后续匹配`;
    }
    return `${t.strategyEpisodeFuture} ${strategy.episodeStart}`;
  }
  return t.strategyFutureOnlyMode;
}

function formatBatchPolicy(policy: string | null | undefined, t: ReturnType<typeof getMessages>) {
  if (policy === "reject") {
    return t.strategyBatchReject;
  }
  if (policy === "allow") {
    return t.strategyBatchAllow;
  }
  return t.strategyBatchReview;
}

function candidateMatchesSubscription(candidate: Candidate, subscription: Subscription) {
  if (!candidateEligibleForSubscription(candidate, subscription)) {
    return false;
  }

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

function subscriptionMatchesGroupFutureRule(group: CandidateGroup, subscription: Subscription) {
  return (
    !subscription.preferredVariantKey &&
    (subscription.episodeMode ?? "future_only") === "future_only" &&
    (subscription.seasonNumber ?? null) === (group.season ?? null)
  );
}

function candidateEligibleForSubscription(candidate: Candidate, subscription: Subscription) {
  if (candidateIsBatch(candidate) && (subscription.batchPolicy ?? "review") === "reject") {
    return false;
  }
  if (
    (subscription.seasonMode ?? "unknown_review") === "specific" &&
    subscription.seasonNumber &&
    candidate.season &&
    candidate.season !== subscription.seasonNumber
  ) {
    return false;
  }
  const episode = candidate.episodeNumber;
  if (episode !== null && episode !== undefined) {
    if (subscription.episodeStart && episode < subscription.episodeStart) {
      return false;
    }
    if (subscription.episodeEnd && episode > subscription.episodeEnd) {
      return false;
    }
  }
  return true;
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
  if (input.filter === "BATCH") {
    params.set("category", "batch");
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
