import { jsonError, jsonResponse } from "@/lib/api";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const view = url.searchParams.get("view") ?? "active";
    const requestedLimit = Number(url.searchParams.get("limit"));
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.floor(requestedLimit), 1), 300)
      : view === "all"
        ? 200
        : 100;
    const where =
      view === "subscribed"
        ? { subscriptions: { some: { enabled: true } } }
        : view === "empty"
          ? { candidates: { none: {} }, subscriptions: { none: { enabled: true } } }
          : view === "all"
            ? {}
            : { candidates: { some: {} }, subscriptions: { none: { enabled: true } } };
    const groups = await prisma.releaseCandidateGroup.findMany({
      where,
      orderBy: [{ candidates: { _count: "desc" } }, { updatedAt: "desc" }],
      take: limit,
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
    const [totalGroups, emptyGroups, ungroupedCandidates] = await Promise.all([
      prisma.releaseCandidateGroup.count(),
      prisma.releaseCandidateGroup.count({
        where: { candidates: { none: {} } },
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
        emptyGroups,
        ungroupedCandidates,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
