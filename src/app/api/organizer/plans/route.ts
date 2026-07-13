import type { OrganizerPlanStatus, Prisma } from "@prisma/client";
import { jsonError, jsonResponse } from "@/lib/api";
import { prisma } from "@/lib/db";
import { assessOrganizerPlanAutomation } from "@/lib/organizer";

export const dynamic = "force-dynamic";

const activeStatuses = ["PENDING", "NEEDS_REVIEW", "CONFLICT", "FAILED"] as const;
const historyStatuses = ["EXECUTED", "AUTO_ARCHIVED", "REJECTED"] as const;
const statusValues = [...activeStatuses, ...historyStatuses] as const;
const statusSet = new Set<string>(statusValues);
const minAutoOrganizerConfidence = 0.9;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const view = url.searchParams.get("view") ?? "active";
    const status = url.searchParams.get("status");
    const includeResolved = url.searchParams.get("includeResolved") === "true";
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
      status: { in: statusFilter },
      ...(status === "REJECTED" && !includeResolved ? { resolvedAt: null } : {}),
      ...(activeView ? { items: { some: {} } } : {}),
      ...(view === "auto"
        ? {
            autoExecutable: true,
            confidence: { gte: minAutoOrganizerConfidence },
            items: { some: {}, every: { conflict: false } },
          }
        : {}),
    } satisfies Prisma.OrganizerPlanWhereInput;
    const [plans, filteredTotal, groupedStatuses, active, autoExecutable, all] = await Promise.all([
      prisma.organizerPlan.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip,
        take: pageSize,
        include: {
          items: true,
          candidate: { include: { group: true } },
          download: true,
          mediaTitle: true,
        },
      }),
      prisma.organizerPlan.count({ where }),
      prisma.organizerPlan.groupBy({
        by: ["status"],
        where: {
          OR: [{ status: { not: "REJECTED" } }, { resolvedAt: null }],
        },
        _count: { _all: true },
      }),
      prisma.organizerPlan.count({
        where: {
          status: { in: [...activeStatuses] },
          items: { some: {} },
        },
      }),
      prisma.organizerPlan.count({
        where: {
          status: "PENDING",
          autoExecutable: true,
          confidence: { gte: minAutoOrganizerConfidence },
          items: { some: {}, every: { conflict: false } },
        },
      }),
      prisma.organizerPlan.count(),
    ]);
    const plansWithAutomation = plans.map((plan) => ({
      ...plan,
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

function clampPositiveInt(value: number, fallback: number, max: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(value), 1), max);
}
