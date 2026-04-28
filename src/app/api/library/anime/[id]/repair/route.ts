import { z } from "zod";
import { jsonError, jsonResponse } from "@/lib/api";
import { prisma } from "@/lib/db";
import { refreshAnimeMetadata } from "@/lib/metadata";

export const dynamic = "force-dynamic";

const repairSchema = z.object({
  action: z.enum(["refreshMetadata", "clearMetadata", "rebuildTitleFromEpisodes"]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const input = repairSchema.parse(body);

    if (input.action === "refreshMetadata") {
      return jsonResponse(await refreshAnimeMetadata(id));
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

    const suggestedTitle = await inferTitleFromEpisodes(id);
    if (!suggestedTitle) {
      return jsonResponse({ updated: false, reason: "No episode title available." }, { status: 422 });
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

async function inferTitleFromEpisodes(mediaId: string) {
  const media = await prisma.mediaTitle.findUniqueOrThrow({
    where: { id: mediaId },
    include: {
      seasons: {
        include: {
          episodes: {
            select: {
              title: true,
            },
          },
        },
      },
    },
  });
  const counts = new Map<string, number>();
  for (const episode of media.seasons.flatMap((season) => season.episodes)) {
    const title = episode.title?.trim();
    if (!title || title.length < 3 || title.toLowerCase() === "unknown") {
      continue;
    }
    counts.set(title, (counts.get(title) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0] ?? null;
}
