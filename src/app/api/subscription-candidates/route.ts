import { jsonError, jsonResponse } from "@/lib/api";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const groups = await prisma.releaseCandidateGroup.findMany({
      orderBy: [{ updatedAt: "desc" }],
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
    return jsonResponse({ groups });
  } catch (error) {
    return jsonError(error);
  }
}
