import type { OrganizerPlanStatus, Prisma } from "@prisma/client";
import { jsonError, jsonResponse } from "@/lib/api";
import { prisma } from "@/lib/db";
import { assessOrganizerPlanAutomation } from "@/lib/organizer";
import { createOrganizerPlanVersion } from "@/lib/organizer-plan-version";

export const dynamic = "force-dynamic";

const activeStatuses = ["PENDING", "NEEDS_REVIEW", "EXECUTING", "CONFLICT", "FAILED"] as const;
const historyStatuses = ["EXECUTED", "AUTO_ARCHIVED", "REJECTED"] as const;
const statusValues = [...activeStatuses, ...historyStatuses] as const;
const statusSet = new Set<string>(statusValues);
const minAutoOrganizerConfidence = 0.9;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const view = url.searchParams.get("view") ?? "active";
    const planId = url.searchParams.get("planId")?.trim() || null;
    const mediaTitleId = url.searchParams.get("mediaTitleId")?.trim() || null;
    const status = url.searchParams.get("status");
    const includeResolved =
      Boolean(planId) || view === "all" || url.searchParams.get("includeResolved") === "true";
    const page = clampPositiveInt(Number(url.searchParams.get("page")), 1, 10_000);
    const requestedPageSize = Number(url.searchParams.get("pageSize"));
    const requestedLimit = Number(url.searchParams.get("limit"));
    const pagination = url.searchParams.has("page") || url.searchParams.has("pageSize");
    const pageSize = pagination
      ? clampPositiveInt(requestedPageSize, 50, 100)
      : Number.isFinite(requestedLimit)
        ? Math.min(Math.max(Math.floor(requestedLimit), 1), 300)
        : view === "history"
          ? 100
          : 200;
    const skip = pagination ? (page - 1) * pageSize : 0;
    const statusFilter: OrganizerPlanStatus[] =
      status && statusSet.has(status)
        ? [status as OrganizerPlanStatus]
        : view === "auto"
          ? ["PENDING"]
          : view === "history"
            ? [...historyStatuses]
            : view === "all"
              ? [...statusValues]
              : [...activeStatuses];
    const activeView = view === "active" && !status;
    const where = {
      ...(planId ? { id: planId } : {}),
      ...(mediaTitleId ? { mediaTitleId } : {}),
      status: { in: statusFilter },
      ...(!includeResolved ? { resolvedAt: null } : {}),
      ...(activeView ? { items: { some: {} } } : {}),
      ...(view === "auto"
        ? {
            autoExecutable: true,
            confidence: { gte: minAutoOrganizerConfidence },
            items: { some: {}, every: { conflict: false } },
          }
        : {}),
    } satisfies Prisma.OrganizerPlanWhereInput;
    const scopeWhere = mediaTitleId ? { mediaTitleId } : undefined;
    const [plans, filteredTotal, groupedStatuses, active, autoExecutable, all] = await Promise.all([
      prisma.organizerPlan.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip,
        take: pageSize,
        select: {
          id: true,
          mediaType: true,
          status: true,
          confidence: true,
          reason: true,
          autoExecutable: true,
          updatedAt: true,
          metadata: true,
          items: {
            select: {
              id: true,
              sourcePath: true,
              targetPath: true,
              fileType: true,
              conflict: true,
              conflictReason: true,
            },
          },
          candidate: {
            select: {
              mediaType: true,
              parsedTitle: true,
              normalizedTitle: true,
              group: {
                select: {
                  displayTitle: true,
                  normalizedTitle: true,
                  aliases: true,
                },
              },
            },
          },
        },
      }),
      prisma.organizerPlan.count({ where }),
      prisma.organizerPlan.groupBy({
        by: ["status"],
        where: { ...scopeWhere, resolvedAt: null },
        _count: { _all: true },
      }),
      prisma.organizerPlan.count({
        where: {
          ...scopeWhere,
          status: { in: [...activeStatuses] },
          resolvedAt: null,
          items: { some: {} },
        },
      }),
      prisma.organizerPlan.count({
        where: {
          ...scopeWhere,
          status: "PENDING",
          resolvedAt: null,
          autoExecutable: true,
          confidence: { gte: minAutoOrganizerConfidence },
          items: { some: {}, every: { conflict: false } },
        },
      }),
      prisma.organizerPlan.count({ where: scopeWhere }),
    ]);
    const plansWithAutomation = plans.map((plan) => ({
      id: plan.id,
      mediaType: plan.mediaType,
      status: plan.status,
      confidence: plan.confidence,
      reason: plan.reason,
      autoExecutable: plan.autoExecutable,
      version: createOrganizerPlanVersion(plan),
      metadata: summarizeMetadata(plan.metadata),
      candidate: plan.candidate
        ? {
            parsedTitle: plan.candidate.parsedTitle,
            group: plan.candidate.group
              ? { displayTitle: plan.candidate.group.displayTitle }
              : null,
          }
        : null,
      items: plan.items.map((item) => ({
        id: item.id,
        sourcePath: item.sourcePath,
        targetPath: item.targetPath,
        fileType: item.fileType,
        conflict: item.conflict,
        conflictReason: item.conflictReason,
      })),
      automation: assessOrganizerPlanAutomation(plan),
    }));
    return jsonResponse({
      plans: plansWithAutomation,
      stats: {
        active,
        autoExecutable,
        all,
        byStatus: Object.fromEntries(
          groupedStatuses.map((item) => [item.status, item._count._all]),
        ),
      },
      page: {
        page,
        pageSize,
        total: filteredTotal,
        totalPages: Math.max(1, Math.ceil(filteredTotal / pageSize)),
        hasNext: skip + plans.length < filteredTotal,
        hasPrevious: skip > 0,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

function summarizeMetadata(metadata: Prisma.JsonValue | null) {
  if (!metadata || Array.isArray(metadata) || typeof metadata !== "object") {
    return null;
  }

  return {
    title: typeof metadata.title === "string" ? metadata.title : undefined,
    posterUrl: typeof metadata.posterUrl === "string" ? metadata.posterUrl : undefined,
    year: typeof metadata.year === "number" ? metadata.year : undefined,
    aiReview: summarizeAiReview(metadata.aiReview),
  };
}

function summarizeAiReview(value: Prisma.JsonValue | undefined) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return undefined;
  }
  const riskLevel = value.riskLevel;
  const confidence = value.confidence;
  if (
    !["OK", "REVIEW", "REJECT"].includes(typeof riskLevel === "string" ? riskLevel : "") ||
    typeof confidence !== "number"
  ) {
    return undefined;
  }
  return {
    riskLevel,
    confidence,
    summary: typeof value.summary === "string" ? value.summary : "",
    acceptedItems: Array.isArray(value.acceptedSourcePaths)
      ? value.acceptedSourcePaths.filter((item) => typeof item === "string").length
      : 0,
    rejectedItems: Array.isArray(value.rejectedSourcePaths)
      ? value.rejectedSourcePaths.filter((item) => typeof item === "string").length
      : 0,
    fileClassifications: summarizeAiFileClassifications(value.fileClassifications),
    appliedAt: typeof value.appliedAt === "string" ? value.appliedAt : undefined,
  };
}

function summarizeAiFileClassifications(value: Prisma.JsonValue | undefined) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!item || Array.isArray(item) || typeof item !== "object") {
      return [];
    }
    const sourcePath = item.sourcePath;
    const role = item.role;
    const confidence = item.confidence;
    if (
      typeof sourcePath !== "string" ||
      !["MAIN_VIDEO", "EXTRA_VIDEO", "AUDIO", "IMAGE", "METADATA", "UNRELATED"].includes(
        typeof role === "string" ? role : "",
      ) ||
      typeof confidence !== "number"
    ) {
      return [];
    }
    return [{
      sourcePath,
      role,
      mediaType: typeof item.mediaType === "string" ? item.mediaType : null,
      title: typeof item.title === "string" ? item.title : null,
      season: typeof item.season === "number" ? item.season : null,
      episodeNumber: typeof item.episodeNumber === "number" ? item.episodeNumber : null,
      confidence,
      evidence: typeof item.evidence === "string" ? item.evidence : "",
    }];
  });
}

function clampPositiveInt(value: number, fallback: number, max: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(value), 1), max);
}
