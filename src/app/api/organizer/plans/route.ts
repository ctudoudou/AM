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
    const requestedLimit = Number(url.searchParams.get("limit"));
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.floor(requestedLimit), 1), 300)
      : view === "history"
        ? 100
        : 200;
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
      ...(activeView ? { items: { some: {} } } : {}),
      ...(view === "auto"
        ? {
            autoExecutable: true,
            confidence: { gte: minAutoOrganizerConfidence },
            items: { some: {}, every: { conflict: false } },
          }
        : {}),
    } satisfies Prisma.OrganizerPlanWhereInput;
    const [plans, groupedStatuses, active, autoExecutable, all] = await Promise.all([
      prisma.organizerPlan.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take: limit,
        include: {
          items: true,
          candidate: { include: { group: true } },
          download: true,
          mediaTitle: true,
        },
      }),
      prisma.organizerPlan.groupBy({
        by: ["status"],
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
    });
  } catch (error) {
    return jsonError(error);
  }
}
