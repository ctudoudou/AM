import { jsonError, jsonResponse } from "@/lib/api";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const activeStatuses = ["PENDING", "NEEDS_REVIEW", "CONFLICT", "FAILED"] as const;
const historyStatuses = ["EXECUTED", "AUTO_ARCHIVED", "REJECTED"] as const;
const statusValues = [...activeStatuses, ...historyStatuses] as const;
const statusSet = new Set<string>(statusValues);

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
    const statusFilter =
      status && statusSet.has(status)
        ? [status]
        : view === "history"
          ? [...historyStatuses]
          : view === "all"
            ? [...statusValues]
            : [...activeStatuses];
    const plans = await prisma.organizerPlan.findMany({
      where: { status: { in: statusFilter } },
      orderBy: { updatedAt: "desc" },
      take: limit,
      include: {
        items: true,
        candidate: { include: { group: true } },
        download: true,
        mediaTitle: true,
      },
    });
    return jsonResponse({ plans });
  } catch (error) {
    return jsonError(error);
  }
}
