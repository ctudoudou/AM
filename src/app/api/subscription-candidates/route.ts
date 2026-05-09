import type { MediaType, Prisma } from "@prisma/client";
import { jsonError, jsonResponse } from "@/lib/api";
import { prisma } from "@/lib/db";

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
    const viewWhere = whereForView(view);
    const where = mergeWhere(
      viewWhere,
      mediaType ? { mediaType } : {},
      whereForStatus(status),
      whereForQuery(query),
    );
    const groups = await prisma.releaseCandidateGroup.findMany({
      where,
      orderBy: orderByForSort(sort),
      skip,
      take,
      include: {
        _count: { select: { candidates: true, subscriptions: true } },
        candidates: {
          orderBy: [{ episodeNumber: "asc" }, { createdAt: "desc" }],
          select: {
            id: true,
            mediaType: true,
            rawTitle: true,
            episodeNumber: true,
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
          },
        },
      },
    });
    const [
      totalGroups,
      filteredGroups,
      activeGroups,
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
    return jsonResponse({
      groups,
      stats: {
        totalGroups,
        filteredGroups,
        activeGroups,
        subscribedGroups,
        emptyGroups,
        reviewGroups,
        ungroupedCandidates,
      },
      page: {
        page,
        pageSize: take,
        total: filteredGroups,
        totalPages: Math.max(1, Math.ceil(filteredGroups / take)),
        hasNext: skip + groups.length < filteredGroups,
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
    return { candidates: { none: {} }, subscriptions: { none: { enabled: true } } };
  }
  if (view === "all") {
    return {};
  }
  return { candidates: { some: {} }, subscriptions: { none: { enabled: true } } };
}

function whereForStatus(status: string): Prisma.ReleaseCandidateGroupWhereInput {
  if (status === "READY") {
    return { candidates: { some: {} }, reviewRequired: false };
  }
  if (status === "REVIEW") {
    return { reviewRequired: true };
  }
  if (status === "SUBSCRIBED") {
    return { subscriptions: { some: { enabled: true } } };
  }
  if (status === "EMPTY") {
    return { candidates: { none: {} } };
  }
  return {};
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
