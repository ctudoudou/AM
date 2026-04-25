import { NextResponse } from "next/server";
import { jsonError, jsonResponse } from "@/lib/api";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const group = await prisma.releaseCandidateGroup.findUnique({
      where: { id },
      include: {
        candidates: {
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

    return jsonResponse(group);
  } catch (error) {
    return jsonError(error);
  }
}
