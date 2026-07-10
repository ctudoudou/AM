import { Prisma, type MediaType } from "@prisma/client";
import { jsonError, jsonResponse } from "@/lib/api";
import { prisma } from "@/lib/db";
import {
  createMediaIdentity,
  jsonStringList,
  prepareSubscriptionCoverage,
  preparedSubscriptionCoversCandidateGroup,
  type PreparedSubscriptionCoverage,
  type SubscriptionCoverageInput,
} from "@/lib/media-identity";
import { classifyReleaseResource } from "@/lib/release-resource";
import { describeSubscriptionQueueGroup } from "@/lib/subscription-queue-state";
import {
  latestCandidateWindowSize,
  shouldUseLatestCandidateWindow,
} from "@/lib/subscription-candidate-window";
import { candidateIsBatch } from "@/lib/subscription-strategy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const view = url.searchParams.get("view") ?? "active";
    const page = clampPositiveInt(Number(url.searchParams.get("page")), 1, 1_000);
    const pageSize = clampPositiveInt(Number(url.searchParams.get("pageSize")), 50, 100);
    const requestedLimit = Number(url.searchParams.get("limit"));
    const defaultLimit = view === "all" || view === "subscribed" ? 300 : 100;
    const legacyLimit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.floor(requestedLimit), 1), 300)
      : defaultLimit;
    const pagination = url.searchParams.has("page") || url.searchParams.has("pageSize");
    const take = pagination ? pageSize : legacyLimit;
    const skip = pagination ? (page - 1) * pageSize : 0;
    const mediaType = normalizeMediaType(url.searchParams.get("mediaType"));
    const status = url.searchParams.get("status") ?? "ALL";
    const query = url.searchParams.get("q")?.trim() ?? "";
    const sort = normalizeSort(url.searchParams.get("sort"));
    const category = normalizeCategory(url.searchParams.get("category"));
    const sourceScope = normalizeSourceScope(url.searchParams.get("source"), view);
    const viewWhere = whereForView(view);
    const filterCanonicalCoverage = shouldFilterCanonicalCoverage(view, status);
    const postProcessPagination = filterCanonicalCoverage || category !== "ALL" || sort === "LATEST";
    const fastCandidateWindowPromise = shouldUseLatestCandidateWindow({
      category,
      filterCanonicalCoverage,
      mediaType,
      query,
      sort,
      status,
    })
      ? latestCandidateGroupWindow({
          category,
          skip,
          sourceScope,
          take,
        })
      : Promise.resolve(null);
    const candidateWhere = candidateWhereForSourceScope(sourceScope);
    const [fastCandidateWindow, enabledSubscriptions] = await Promise.all([
      fastCandidateWindowPromise,
      prisma.subscription.findMany({
        where: { enabled: true, candidateGroupId: { not: null } },
        include: { candidateGroup: true },
      }),
    ]);
    const preparedSubscriptions = enabledSubscriptions.map((subscription) => ({
      subscription,
      coverage: prepareSubscriptionCoverage(subscriptionCoverageInput(subscription)),
    }));
    const where = mergeWhere(
      viewWhere,
      whereForSourceScope(sourceScope),
      fastCandidateWindow ? { id: { in: fastCandidateWindow.ids } } : {},
      mediaType ? { mediaType } : {},
      whereForStatus(status),
      whereForQuery(query),
    );
    const rawGroups = await prisma.releaseCandidateGroup.findMany({
      where,
      orderBy: orderByForSort(sort),
      skip: postProcessPagination ? 0 : skip,
      take: postProcessPagination || fastCandidateWindow ? undefined : take,
      include: {
        _count: { select: { candidates: true, subscriptions: true } },
        subscriptions: {
          where: { enabled: true },
          select: { id: true },
        },
        candidates: {
          where: candidateWhere,
          orderBy: [{ episodeNumber: "asc" }, { createdAt: "desc" }],
          select: {
            id: true,
            mediaType: true,
            rawTitle: true,
            episodeNumber: true,
            season: true,
            subtitleGroup: true,
            resolution: true,
            codec: true,
            audio: true,
            subtitleLanguage: true,
            releaseProfile: true,
            sourceKind: true,
            variantKey: true,
            status: true,
            createdAt: true,
            rssItem: {
              select: {
                origin: true,
                createdAt: true,
                publishedAt: true,
                status: true,
                source: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    const annotatedGroups = rawGroups.map((group) => {
      const candidates = group.candidates.filter(
        (candidate) => classifyReleaseResource(candidate.rawTitle).kind !== "NON_VIDEO",
      );
      const groupIdentity = createMediaIdentity(candidateGroupCoverageInput(group));
      const coveredBySubscription = preparedSubscriptions.find(
        ({ coverage, subscription }) =>
          subscription.candidateGroupId !== group.id &&
          preparedSubscriptionCoversCandidateGroup(
            coverage,
            groupIdentity,
          ),
      );
      const coveringSubscription = coveredBySubscription?.subscription;
      return {
        ...group,
        candidates,
        _count: {
          ...group._count,
          candidates: candidates.length,
        },
        coveredBySubscription: coveringSubscription
          ? {
              id: coveringSubscription.id,
              title: coveringSubscription.title,
              candidateGroupId: coveringSubscription.candidateGroupId,
            }
          : null,
      };
    });
    const visibleGroups = filterCanonicalCoverage
      ? annotatedGroups.filter((group) => !group.coveredBySubscription && group.candidates.length > 0)
      : annotatedGroups;
    const categorizedGroups = visibleGroups.filter((group) => groupMatchesCategory(group, category));
    const sortedGroups = sortGroupsForResponse(categorizedGroups, sort);
    const groups = postProcessPagination
      ? sortedGroups.slice(skip, skip + take)
      : sortedGroups;
    const [
      totalGroups,
      databaseFilteredGroups,
      databaseActiveGroups,
      subscribedGroups,
      emptyGroups,
      reviewGroups,
      ungroupedCandidates,
    ] = await Promise.all([
      prisma.releaseCandidateGroup.count(),
      prisma.releaseCandidateGroup.count({ where }),
      prisma.releaseCandidateGroup.count({ where: whereForView("active") }),
      prisma.releaseCandidateGroup.count({ where: whereForView("subscribed") }),
      prisma.releaseCandidateGroup.count({
        where: whereForView("empty"),
      }),
      prisma.releaseCandidateGroup.count({
        where: { reviewRequired: true },
      }),
      prisma.releaseCandidate.count({
        where: {
          groupId: null,
          status: { in: ["NEW", "READY", "REVIEW"] },
        },
      }),
    ]);
    const filteredGroupCount = fastCandidateWindow
      ? fastCandidateWindow.total
      : postProcessPagination
        ? categorizedGroups.length
        : databaseFilteredGroups;
    const activeGroupCount = filterCanonicalCoverage
      ? await countCanonicallyActiveGroups(preparedSubscriptions, sourceScope)
      : databaseActiveGroups;
    const responseGroupCount =
      fastCandidateWindow && category === "ALL" ? activeGroupCount : filteredGroupCount;
    return jsonResponse({
      groups: groups.map((group) => ({
        ...group,
        queueStatus: describeSubscriptionQueueGroup({
          candidateCount: group._count.candidates,
          enabledSubscriptionCount: group.subscriptions.length,
          reviewRequired: group.reviewRequired,
        }),
        sourceSummary: summarizeGroupSources(group),
      })),
      stats: {
        totalGroups,
        filteredGroups: responseGroupCount,
        activeGroups: activeGroupCount,
        subscribedGroups,
        emptyGroups,
        reviewGroups,
        ungroupedCandidates,
      },
      page: {
        page,
        pageSize: take,
        total: responseGroupCount,
        totalPages: Math.max(1, Math.ceil(responseGroupCount / take)),
        hasNext: skip + groups.length < responseGroupCount,
        hasPrevious: skip > 0,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

function whereForView(view: string): Prisma.ReleaseCandidateGroupWhereInput {
  if (view === "subscribed") {
    return { subscriptions: { some: { enabled: true } } };
  }
  if (view === "empty") {
    return {
      candidates: { none: { status: { not: "IGNORED" } } },
      subscriptions: { none: { enabled: true } },
    };
  }
  if (view === "all") {
    return {};
  }
  return {
    candidates: { some: { status: { not: "IGNORED" } } },
    subscriptions: { none: { enabled: true } },
  };
}

function shouldFilterCanonicalCoverage(view: string, status: string) {
  return (view === "active" || view === "queue" || view === "") && status !== "SUBSCRIBED";
}

async function countCanonicallyActiveGroups(
  enabledSubscriptions: PreparedEnabledSubscription[],
  sourceScope: SourceScope,
) {
  const activeGroups = await prisma.releaseCandidateGroup.findMany({
    where: mergeWhere(whereForView("active"), whereForSourceScope(sourceScope)),
    select: {
      id: true,
      mediaType: true,
      displayTitle: true,
      normalizedTitle: true,
      aliases: true,
      season: true,
    },
  });
  return activeGroups.filter((group) => {
    const groupIdentity = createMediaIdentity(candidateGroupCoverageInput(group));
    return enabledSubscriptions.every(
      ({ coverage, subscription }) =>
        subscription.candidateGroupId === group.id ||
        !preparedSubscriptionCoversCandidateGroup(coverage, groupIdentity),
    );
  }).length;
}

type PreparedEnabledSubscription = {
  coverage: PreparedSubscriptionCoverage;
  subscription: Parameters<typeof subscriptionCoverageInput>[0];
};

function subscriptionCoverageInput(subscription: {
  mediaType: MediaType;
  title: string;
  seasonMode?: string | null;
  seasonNumber?: number | null;
  candidateGroupId?: string | null;
  candidateGroup?: {
    mediaType: MediaType;
    displayTitle: string;
    normalizedTitle: string;
    aliases?: unknown;
    season?: number | null;
  } | null;
}): SubscriptionCoverageInput {
  return {
    mediaType: subscription.mediaType,
    title: subscription.title,
    seasonMode: subscription.seasonMode,
    seasonNumber: subscription.seasonNumber,
    candidateGroup: subscription.candidateGroup
      ? candidateGroupCoverageInput(subscription.candidateGroup)
      : null,
  };
}

function candidateGroupCoverageInput(group: {
  mediaType: MediaType;
  displayTitle: string;
  normalizedTitle: string;
  aliases?: unknown;
  season?: number | null;
}) {
  return {
    mediaType: group.mediaType,
    displayTitle: group.displayTitle,
    normalizedTitle: group.normalizedTitle,
    aliases: jsonStringList(group.aliases),
    season: group.season ?? null,
  };
}

function whereForStatus(status: string): Prisma.ReleaseCandidateGroupWhereInput {
  if (status === "READY") {
    return { candidates: { some: { status: { not: "IGNORED" } } }, reviewRequired: false };
  }
  if (status === "ACTIONABLE") {
    return {
      candidates: { some: { status: { not: "IGNORED" } } },
      reviewRequired: false,
      subscriptions: { none: { enabled: true } },
    };
  }
  if (status === "REVIEW") {
    return { reviewRequired: true };
  }
  if (status === "SUBSCRIBED") {
    return { subscriptions: { some: { enabled: true } } };
  }
  if (status === "EMPTY") {
    return { candidates: { none: { status: { not: "IGNORED" } } } };
  }
  return {};
}

type SourceScope = "SUBSCRIPTION" | "IMPORT_SCAN" | "ALL";
type CandidateCategory = "ALL" | "BATCH";

type LatestCandidateWindowInput = {
  category: CandidateCategory;
  skip: number;
  sourceScope: SourceScope;
  take: number;
};

async function latestCandidateGroupWindow(input: LatestCandidateWindowInput) {
  const windowSize = latestCandidateWindowSize(input.skip, input.take);
  const sourceClause = latestCandidateWindowSourceClause(input.sourceScope);
  const batchClause = input.category === "BATCH"
    ? Prisma.sql`
      AND rc."mediaType" <> 'MOVIE'::"MediaType"
      AND (
        rc."episodeNumber" IS NULL OR
        rc."rawTitle" ~* '(?:^|[[:space:]\\[\\]()【】_-])[0-9]{1,3}[[:space:]]*[-~～][[:space:]]*[0-9]{1,3}(?:[[:space:]]*(fin|end|complete|合集|全集|全|完|完结|完結))?(?:$|[[:space:]\\[\\]()【】_-])'
      )
    `
    : Prisma.empty;
  const baseWhere = Prisma.sql`
    rc."groupId" IS NOT NULL
    AND rc.status <> 'IGNORED'
    ${sourceClause}
    ${batchClause}
    AND NOT EXISTS (
      SELECT 1 FROM "Subscription" s
      WHERE s."candidateGroupId" = g.id AND s.enabled = true
    )
  `;
  const [rows, totalRows] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT rc."groupId" AS id
      FROM "ReleaseCandidate" rc
      JOIN "RssItem" ri ON ri.id = rc."rssItemId"
      JOIN "ReleaseCandidateGroup" g ON g.id = rc."groupId"
      WHERE ${baseWhere}
      GROUP BY rc."groupId"
      ORDER BY MAX(GREATEST(rc."createdAt", ri."createdAt", COALESCE(ri."publishedAt", ri."createdAt"))) DESC
      LIMIT ${windowSize}
    `),
    prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS total FROM (
        SELECT rc."groupId"
        FROM "ReleaseCandidate" rc
        JOIN "RssItem" ri ON ri.id = rc."rssItemId"
        JOIN "ReleaseCandidateGroup" g ON g.id = rc."groupId"
        WHERE ${baseWhere}
        GROUP BY rc."groupId"
      ) t
    `),
  ]);
  return {
    ids: rows.map((row) => row.id),
    total: totalRows[0]?.total ?? 0,
  };
}

function latestCandidateWindowSourceClause(sourceScope: SourceScope) {
  if (sourceScope === "SUBSCRIPTION") {
    return Prisma.sql`AND ri.origin <> 'import-scan'`;
  }
  if (sourceScope === "IMPORT_SCAN") {
    return Prisma.sql`AND ri.origin = 'import-scan'`;
  }
  return Prisma.empty;
}

function normalizeSourceScope(value: string | null, view: string): SourceScope {
  if (value === "all") {
    return "ALL";
  }
  if (value === "import-scan") {
    return "IMPORT_SCAN";
  }
  if (value === "subscription") {
    return "SUBSCRIPTION";
  }
  return view === "active" || view === "queue" || view === "" ? "SUBSCRIPTION" : "ALL";
}

function normalizeCategory(value: string | null): CandidateCategory {
  return value === "batch" ? "BATCH" : "ALL";
}

function whereForSourceScope(sourceScope: SourceScope): Prisma.ReleaseCandidateGroupWhereInput {
  if (sourceScope === "SUBSCRIPTION") {
    return {
      candidates: {
        some: {
          status: { not: "IGNORED" },
          rssItem: {
            origin: { not: "import-scan" },
          },
        },
      },
    };
  }
  if (sourceScope === "IMPORT_SCAN") {
    return {
      candidates: {
        some: {
          status: { not: "IGNORED" },
          rssItem: {
            origin: "import-scan",
          },
        },
      },
    };
  }
  return {};
}

function candidateWhereForSourceScope(sourceScope: SourceScope): Prisma.ReleaseCandidateWhereInput | undefined {
  if (sourceScope === "SUBSCRIPTION") {
    return {
      status: { not: "IGNORED" },
      rssItem: { origin: { not: "import-scan" } },
    };
  }
  if (sourceScope === "IMPORT_SCAN") {
    return {
      status: { not: "IGNORED" },
      rssItem: { origin: "import-scan" },
    };
  }
  return { status: { not: "IGNORED" } };
}

function groupMatchesCategory(
  group: { candidates: Array<{ mediaType?: string | null; rawTitle?: string | null; episodeNumber?: number | null }> },
  category: CandidateCategory,
) {
  if (category === "BATCH") {
    return group.candidates.some(candidateIsBatch);
  }
  return true;
}

function summarizeGroupSources(group: {
  updatedAt: Date;
  candidates: Array<{
    createdAt: Date;
    rssItem: {
      origin: string;
      createdAt: Date;
      publishedAt: Date | null;
      source: { id: string; name: string } | null;
    };
  }>;
}) {
  const sources = new Map<string, { id: string | null; name: string; count: number }>();
  let latestFetchedAt: Date | null = null;
  let latestPublishedAt: Date | null = null;

  for (const candidate of group.candidates) {
    const source = candidate.rssItem.source;
    const sourceKey = source?.id ?? `origin:${candidate.rssItem.origin}`;
    const sourceName = source?.name ?? candidate.rssItem.origin;
    const current = sources.get(sourceKey) ?? {
      id: source?.id ?? null,
      name: sourceName,
      count: 0,
    };
    current.count += 1;
    sources.set(sourceKey, current);
    latestFetchedAt = maxDate(latestFetchedAt, candidate.rssItem.createdAt);
    latestPublishedAt = maxDate(latestPublishedAt, candidate.rssItem.publishedAt);
  }

  return {
    candidateCount: group.candidates.length,
    sources: [...sources.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    latestFetchedAt,
    latestPublishedAt,
    latestMergedAt: group.updatedAt,
  };
}

function maxDate(current: Date | null, candidate: Date | null) {
  if (!candidate) {
    return current;
  }
  if (!current || candidate.getTime() > current.getTime()) {
    return candidate;
  }
  return current;
}

function sortGroupsForResponse<T extends {
  confidence: number;
  reviewRequired: boolean;
  _count: { candidates: number; subscriptions: number };
  candidates: Array<{
    createdAt: Date;
    rssItem: {
      createdAt: Date;
      publishedAt: Date | null;
    };
  }>;
}>(groups: T[], sort: ReturnType<typeof normalizeSort>) {
  return [...groups].sort((a, b) => {
    if (sort === "UNSUBSCRIBED") {
      return (
        a._count.subscriptions - b._count.subscriptions ||
        latestGroupCandidateTime(b) - latestGroupCandidateTime(a) ||
        b._count.candidates - a._count.candidates ||
        b.confidence - a.confidence
      );
    }
    if (sort === "VERSIONS") {
      return (
        b._count.candidates - a._count.candidates ||
        latestGroupCandidateTime(b) - latestGroupCandidateTime(a) ||
        b.confidence - a.confidence
      );
    }
    if (sort === "REVIEW") {
      return (
        Number(b.reviewRequired) - Number(a.reviewRequired) ||
        latestGroupCandidateTime(b) - latestGroupCandidateTime(a) ||
        b._count.candidates - a._count.candidates ||
        b.confidence - a.confidence
      );
    }
    return (
      latestGroupCandidateTime(b) - latestGroupCandidateTime(a) ||
      b._count.candidates - a._count.candidates ||
      b.confidence - a.confidence
    );
  });
}

function latestGroupCandidateTime(group: {
  candidates: Array<{
    createdAt: Date;
    rssItem: {
      createdAt: Date;
      publishedAt: Date | null;
    };
  }>;
}) {
  return group.candidates.reduce((latest, candidate) => {
    const times = [
      candidate.rssItem.createdAt,
      candidate.rssItem.publishedAt,
      candidate.createdAt,
    ];
    return Math.max(latest, ...times.map((value) => value?.getTime() ?? 0));
  }, 0);
}

function whereForQuery(query: string): Prisma.ReleaseCandidateGroupWhereInput {
  if (!query) {
    return {};
  }
  const contains = { contains: query, mode: "insensitive" as const };
  return {
    OR: [
      { displayTitle: contains },
      { normalizedTitle: contains },
      { aiSummary: contains },
      {
        candidates: {
          some: {
            OR: [
              { rawTitle: contains },
              { parsedTitle: contains },
              { normalizedTitle: contains },
              { subtitleGroup: contains },
              { resolution: contains },
              { codec: contains },
              { audio: contains },
              { subtitleLanguage: contains },
              { releaseProfile: contains },
              { sourceKind: contains },
            ],
          },
        },
      },
    ],
  };
}

function mergeWhere(...items: Prisma.ReleaseCandidateGroupWhereInput[]) {
  const conditions = items.filter((item) => Object.keys(item).length > 0);
  if (conditions.length === 0) {
    return {};
  }
  if (conditions.length === 1) {
    return conditions[0];
  }
  return { AND: conditions };
}

function normalizeMediaType(value: string | null): MediaType | null {
  if (value === "ANIME" || value === "MOVIE" || value === "TV") {
    return value;
  }
  return null;
}

function normalizeSort(value: string | null) {
  if (value === "UNSUBSCRIBED" || value === "VERSIONS" || value === "REVIEW") {
    return value;
  }
  return "LATEST";
}

function orderByForSort(sort: ReturnType<typeof normalizeSort>) {
  if (sort === "UNSUBSCRIBED") {
    return [
      { subscriptions: { _count: "asc" } },
      { updatedAt: "desc" },
      { candidates: { _count: "desc" } },
    ] satisfies Prisma.ReleaseCandidateGroupOrderByWithRelationInput[];
  }
  if (sort === "VERSIONS") {
    return [
      { candidates: { _count: "desc" } },
      { updatedAt: "desc" },
    ] satisfies Prisma.ReleaseCandidateGroupOrderByWithRelationInput[];
  }
  if (sort === "REVIEW") {
    return [
      { reviewRequired: "desc" },
      { updatedAt: "desc" },
      { candidates: { _count: "desc" } },
    ] satisfies Prisma.ReleaseCandidateGroupOrderByWithRelationInput[];
  }
  return [
    { updatedAt: "desc" },
    { candidates: { _count: "desc" } },
  ] satisfies Prisma.ReleaseCandidateGroupOrderByWithRelationInput[];
}

function clampPositiveInt(value: number, fallback: number, max: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(value), 1), max);
}
