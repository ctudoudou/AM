import { NextResponse } from "next/server";
import { jsonError, jsonResponse } from "@/lib/api";
import { prisma } from "@/lib/db";
import { classifyReleaseResource } from "@/lib/release-resource";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const source = new URL(request.url).searchParams.get("source");
    const group = await prisma.releaseCandidateGroup.findUnique({
      where: { id },
      include: {
        candidates: {
          where: {
            status: { not: "IGNORED" },
            rssItem:
              source === "subscription"
                ? { origin: { not: "import-scan" } }
                : source === "import-scan"
                  ? { origin: "import-scan" }
                  : undefined,
          },
          orderBy: [{ episodeNumber: "desc" }, { createdAt: "desc" }],
          include: { rssItem: { include: { source: true } } },
        },
        subscriptions: true,
      },
    });

    if (!group) {
      return NextResponse.json(
        { error: "CANDIDATE_GROUP_NOT_FOUND" },
        { status: 404 },
      );
    }

    return jsonResponse({
      ...group,
      candidates: group.candidates.filter(
        (candidate) => classifyReleaseResource(candidate.rawTitle).kind !== "NON_VIDEO",
      ),
    });
  } catch (error) {
    return jsonError(error);
  }
}
