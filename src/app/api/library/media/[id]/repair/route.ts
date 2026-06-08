import { z } from "zod";
import { jsonError, jsonResponse } from "@/lib/api";
import { prisma } from "@/lib/db";
import { parseMediaReleaseTitle } from "@/lib/media-parser";
import { refreshMediaMetadata } from "@/lib/metadata";
import { upsertTitleAliases } from "@/lib/title-display";

export const dynamic = "force-dynamic";

const repairSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("refreshMetadata") }),
  z.object({ action: z.literal("clearMetadata") }),
  z.object({ action: z.literal("rebuildTitleFromFiles") }),
  z.object({
    action: z.literal("addAliasAndRefresh"),
    alias: z.string().trim().min(2).max(180),
  }),
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const input = repairSchema.parse(body);

    if (input.action === "refreshMetadata") {
      return jsonResponse(await refreshMediaMetadata(id));
    }

    if (input.action === "addAliasAndRefresh") {
      const aliasResult = await upsertTitleAliases(id, [{ title: input.alias }]);
      return jsonResponse({
        updated: true,
        aliasCreated: aliasResult.created,
        metadata: await refreshMediaMetadata(id),
      });
    }

    if (input.action === "clearMetadata") {
      const media = await prisma.mediaTitle.update({
        where: { id },
        data: {
          year: null,
          synopsis: null,
          posterUrl: null,
          backdropUrl: null,
          rating: null,
          metadata: { deleteMany: {} },
        },
      });
      return jsonResponse({ updated: true, media });
    }

    const suggestedTitle = await inferTitleFromFiles(id);
    if (!suggestedTitle) {
      return jsonResponse({ updated: false, reason: "No media file title available." }, { status: 422 });
    }

    const media = await prisma.mediaTitle.update({
      where: { id },
      data: {
        primaryTitle: suggestedTitle,
        originalTitle: null,
        year: null,
        synopsis: null,
        posterUrl: null,
        backdropUrl: null,
        rating: null,
        metadata: { deleteMany: {} },
      },
    });
    return jsonResponse({ updated: true, media });
  } catch (error) {
    return jsonError(error);
  }
}

async function inferTitleFromFiles(mediaId: string) {
  const media = await prisma.mediaTitle.findUniqueOrThrow({
    where: { id: mediaId },
    include: {
      seasons: {
        include: {
          episodes: {
            include: {
              files: { select: { originalName: true } },
            },
          },
        },
      },
    },
  });
  const counts = new Map<string, number>();
  for (const file of media.seasons.flatMap((season) => season.episodes).flatMap((episode) => episode.files)) {
    const title = parseMediaReleaseTitle(file.originalName, media.type).parsedTitle.trim();
    if (!title || title.length < 2 || title.toLowerCase() === "unknown") {
      continue;
    }
    counts.set(title, (counts.get(title) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0] ?? null;
}
