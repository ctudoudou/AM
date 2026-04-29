"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2, Play, Plus, RefreshCw, Trash2, WandSparkles } from "lucide-react";
import { getMessages } from "@/messages";
import type { Locale } from "@/lib/i18n";

type RssSource = {
  id: string;
  name: string;
  url: string;
  mediaType: MediaType;
  enabled: boolean;
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
  _count: {
    candidates: number;
    subscriptions: number;
  };
};

type CandidateStats = {
  totalGroups: number;
  emptyGroups: number;
  ungroupedCandidates: number;
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

export function SubscriptionsClient({ locale }: { locale: Locale }) {
  const t = getMessages(locale);
  const [groups, setGroups] = useState<CandidateGroup[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [rssSources, setRssSources] = useState<RssSource[]>([]);
  const [candidateFilter, setCandidateFilter] = useState<
    "ALL" | "WITH_CANDIDATES" | "UNSUBSCRIBED" | "SUBSCRIBED" | "EMPTY"
  >("WITH_CANDIDATES");
  const [candidateStats, setCandidateStats] = useState<CandidateStats>({
    totalGroups: 0,
    emptyGroups: 0,
    ungroupedCandidates: 0,
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
  const visibleGroups = useMemo(() => {
    const subscriptionGroupIds = new Set(
      subscriptions
        .map((subscription) => subscription.candidateGroupId)
        .filter(Boolean),
    );
    return groups
      .filter((group) => {
        if (candidateFilter === "WITH_CANDIDATES") {
          return group.candidates.length > 0;
        }
        if (candidateFilter === "UNSUBSCRIBED") {
          return !subscriptionGroupIds.has(group.id) && group.candidates.length > 0;
        }
        if (candidateFilter === "SUBSCRIBED") {
          return subscriptionGroupIds.has(group.id);
        }
        if (candidateFilter === "EMPTY") {
          return group.candidates.length === 0;
        }
        return true;
      })
      .sort((a, b) => {
        const aSubscribed = subscriptionGroupIds.has(a.id) ? 1 : 0;
        const bSubscribed = subscriptionGroupIds.has(b.id) ? 1 : 0;
        return (
          bSubscribed - aSubscribed ||
          b.candidates.length - a.candidates.length ||
          b.confidence - a.confidence
        );
      });
  }, [candidateFilter, groups, subscriptions]);

  const load = useCallback(async () => {
    try {
      const [candidateResponse, rssResponse, subscriptionsResponse] = await Promise.all([
        fetch("/api/subscription-candidates"),
        fetch("/api/rss-sources"),
        fetch("/api/subscriptions"),
      ]);
      if (!candidateResponse.ok || !rssResponse.ok || !subscriptionsResponse.ok) {
        throw new Error(t.subscriptionsLoadError);
      }
      const candidateBody = (await candidateResponse.json()) as {
        groups: CandidateGroup[];
        stats?: CandidateStats;
      };
      const rssBody = (await rssResponse.json()) as { sources: RssSource[] };
      const subscriptionsBody = (await subscriptionsResponse.json()) as {
        subscriptions: Subscription[];
      };
      setGroups(candidateBody.groups);
      setCandidateStats(
        candidateBody.stats ?? {
          totalGroups: candidateBody.groups.length,
          emptyGroups: candidateBody.groups.filter((group) => group.candidates.length === 0).length,
          ungroupedCandidates: 0,
        },
      );
      setRssSources(rssBody.sources);
      setSubscriptions(subscriptionsBody.subscriptions);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t.subscriptionsLoadError);
    } finally {
      setLoading(false);
    }
  }, [t.subscriptionsLoadError]);

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
        preferredGroup: candidate?.subtitleGroup ?? undefined,
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
            <p>{t.subscriptionsRssDescription}</p>
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
        </div>
        <div className="subscription-list">
          {subscriptions.length === 0 ? (
            <p>{t.noActiveSubscriptions}</p>
          ) : (
            subscriptions.map((subscription) => (
              <article key={subscription.id}>
                <div>
                  <h3>{subscription.title}</h3>
                  <p>
                    {formatMediaType(subscription.mediaType, t)} ·{" "}
                    {formatSubscriptionPolicy(subscription)}
                  </p>
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
              {candidateStats.totalGroups} {t.titles} ·{" "}
              {groupsWithVersions} {t.withVersions} ·{" "}
              {candidateStats.ungroupedCandidates} {t.ungroupedCandidates}
            </p>
          </div>
          <div className="filter-tabs">
            {[
              ["WITH_CANDIDATES", t.withVersions],
              ["UNSUBSCRIBED", t.unsubscribed],
              ["SUBSCRIBED", t.subscribed],
              ["EMPTY", t.futureOnly],
              ["ALL", t.subscriptionFilterAll],
            ].map(([key, label]) => (
              <button
                className={candidateFilter === key ? "active" : ""}
                key={key}
                onClick={() =>
                  setCandidateFilter(
                    key as
                      | "ALL"
                      | "WITH_CANDIDATES"
                      | "UNSUBSCRIBED"
                      | "SUBSCRIBED"
                      | "EMPTY",
                  )
                }
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {visibleGroups.length === 0 ? (
          <div className="empty-panel">{t.noCandidates}</div>
        ) : (
          visibleGroups.map((group) => {
            const groupSubscriptions = subscriptions.filter(
              (subscription) => subscription.candidateGroupId === group.id,
            );
            const hasSubscription = groupSubscriptions.length > 0;

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
                    </p>
                  </div>
                  <div className="candidate-heading-actions">
                    <span className={hasSubscription ? "candidate-policy active" : "candidate-policy"}>
                      {hasSubscription ? t.subscribed : t.futureOnlyPolicy}
                    </span>
                    {!hasSubscription ? (
                      <button onClick={() => void createSubscription(group)} type="button">
                        <Plus size={14} />
                        {t.futureOnlySubscribe}
                      </button>
                    ) : null}
                  </div>
                </div>
                {group.aiSummary ? <p className="candidate-summary">{group.aiSummary}</p> : null}
                {group.candidates.length === 0 ? (
                  <div className="candidate-empty-version">{t.noVersionsYet}</div>
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
                                  {formatCandidateMeta(candidate)}
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

function formatCandidateMeta(candidate: Candidate) {
  return [
    candidate.subtitleGroup,
    candidate.releaseProfile,
    candidate.subtitleLanguage,
    candidate.sourceKind,
    candidate.resolution,
    candidate.codec,
    candidate.audio,
    candidate.status,
  ]
    .filter(Boolean)
    .join(" · ");
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
