import { z } from "zod";
import { jsonError, jsonResponse } from "@/lib/api";
import { getMediaLibrary } from "@/lib/media-library";
import { addMediaTitleAliases, findExistingMediaTitle } from "@/lib/media-title-repair";
import { refreshAnimeMetadata } from "@/lib/metadata";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const createAnimeSchema = z.object({
  title: z.string().trim().min(1),
  originalTitle: z.string().trim().optional(),
  year: z.coerce.number().int().min(1900).max(2100).optional().nullable(),
  aliases: z.array(z.string().trim().min(1)).optional(),
  refreshMetadata: z.boolean().optional().default(true),
});

export async function GET() {
  try {
    return jsonResponse({ titles: await getMediaLibrary("ANIME") });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = createAnimeSchema.parse(await request.json());
    const aliases = [
      input.originalTitle,
      ...(input.aliases ?? []),
    ];
    const existing = await findExistingMediaTitle({
      type: "ANIME",
      title: input.title,
      originalTitle: input.originalTitle,
      year: input.year,
      aliases,
    });
    const media =
      existing ??
      (await prisma.mediaTitle.create({
        data: {
          type: "ANIME",
          primaryTitle: input.title,
          originalTitle: input.originalTitle || null,
          year: input.year ?? null,
        },
      }));

    await addMediaTitleAliases(media.id, [input.title, input.originalTitle, ...(input.aliases ?? [])]);

    let metadataError: string | null = null;
    if (input.refreshMetadata) {
      await refreshAnimeMetadata(media.id).catch((error) => {
        metadataError = error instanceof Error ? error.message : "Metadata refresh failed.";
      });
    }

    return jsonResponse(
      {
        media: await prisma.mediaTitle.findUniqueOrThrow({ where: { id: media.id } }),
        created: !existing,
        metadataError,
      },
      { status: existing ? 200 : 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
