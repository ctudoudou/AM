import { z } from "zod";
import { prisma } from "@/lib/db";

const catalogProviderSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[a-z][a-z0-9_-]{0,31}$/i, "Provider must be a short identifier");

const seasonCatalogEntrySchema = z
  .object({
    seasonNumber: z.coerce.number().int().positive(),
    episodeCount: z.coerce.number().int().positive(),
    absoluteStart: z.coerce.number().int().positive().nullable().optional(),
    absoluteEnd: z.coerce.number().int().positive().nullable().optional(),
    provider: catalogProviderSchema.optional(),
    sourceUrl: z.string().trim().url().nullable().optional(),
    confidence: z.coerce.number().min(0).max(1).default(1),
  })
  .superRefine((entry, context) => {
    const hasStart = entry.absoluteStart !== null && entry.absoluteStart !== undefined;
    const hasEnd = entry.absoluteEnd !== null && entry.absoluteEnd !== undefined;
    if (hasStart !== hasEnd) {
      context.addIssue({
        code: "custom",
        message: "absoluteStart and absoluteEnd must be set together",
      });
      return;
    }
    if (hasStart && hasEnd && Number(entry.absoluteEnd) < Number(entry.absoluteStart)) {
      context.addIssue({
        code: "custom",
        message: "absoluteEnd must be greater than or equal to absoluteStart",
      });
    }
  });

const updateSeasonCatalogSchema = z.object({
  entries: z.array(seasonCatalogEntrySchema).max(100),
  provider: catalogProviderSchema.default("manual"),
});

export type SeasonCatalogEntryInput = z.infer<typeof seasonCatalogEntrySchema>;

export async function getSeasonCatalog(mediaTitleId: string) {
  const media = await prisma.mediaTitle.findUniqueOrThrow({
    where: { id: mediaTitleId },
    select: {
      id: true,
      type: true,
      primaryTitle: true,
      seasonCatalogs: {
        orderBy: [{ seasonNumber: "asc" }, { confidence: "desc" }],
      },
    },
  });

  return {
    mediaTitleId: media.id,
    type: media.type,
    primaryTitle: media.primaryTitle,
    entries: media.seasonCatalogs,
  };
}

export async function replaceSeasonCatalog(mediaTitleId: string, input: unknown) {
  const payload = updateSeasonCatalogSchema.parse(input);
  await prisma.mediaTitle.findUniqueOrThrow({
    where: { id: mediaTitleId },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.seasonCatalog.deleteMany({
      where: {
        mediaTitleId,
        provider: payload.provider,
      },
    });

    for (const entry of payload.entries) {
      const provider = entry.provider ?? payload.provider;
      if (provider !== payload.provider) {
        throw new Error("All entries in a replacement request must use the selected provider");
      }
      await tx.seasonCatalog.create({
        data: {
          mediaTitleId,
          seasonNumber: entry.seasonNumber,
          episodeCount: entry.episodeCount,
          absoluteStart: entry.absoluteStart ?? null,
          absoluteEnd: entry.absoluteEnd ?? null,
          provider,
          sourceUrl: entry.sourceUrl ?? null,
          confidence: entry.confidence,
        },
      });
    }
  });

  return getSeasonCatalog(mediaTitleId);
}
