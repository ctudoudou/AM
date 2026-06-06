import { z } from "zod";
import { jsonError, jsonResponse } from "@/lib/api";
import { selectHistoryBackfillDownload } from "@/lib/history-backfill";

export const dynamic = "force-dynamic";

const torrentAvailabilitySchema = z.object({
  status: z.enum(["available", "reported", "unknown", "unavailable", "not_probeable"]),
  source: z.enum(["aria2", "index"]),
  checkedAt: z.string().nullable(),
  reason: z.string(),
  seeders: z.number().nullable(),
  connections: z.number().nullable(),
  downloadSpeed: z.string().nullable(),
  infoHash: z.string().nullable(),
  metadataResolved: z.boolean(),
});

const wantedSearchResultSchema = z.object({
  key: z.string().min(1),
  provider: z.string().min(1),
  sourceId: z.string().nullable(),
  sourceName: z.string().min(1),
  title: z.string().min(1),
  link: z.string().nullable(),
  magnetUrl: z.string().nullable(),
  torrentUrl: z.string().nullable(),
  publishedAt: z.string().nullable(),
  seeders: z.number().nullable(),
  size: z.string().nullable(),
  availability: torrentAvailabilitySchema.optional(),
  match: z.enum(["strong", "related"]),
  reason: z.string(),
  parsed: z.object({
    title: z.string(),
    episodeNumber: z.number().nullable(),
    season: z.number().nullable(),
    resolution: z.string().nullable(),
    subtitleGroup: z.string().nullable(),
    codec: z.string().nullable(),
  }),
});

const selectSchema = z.object({
  mediaTitleId: z.string().min(1),
  seasonNumber: z.coerce.number().int().positive(),
  episodeNumber: z.coerce.number().int().positive(),
  result: wantedSearchResultSchema,
});

export async function POST(request: Request) {
  try {
    return jsonResponse(await selectHistoryBackfillDownload(selectSchema.parse(await request.json())), {
      status: 201,
    });
  } catch (error) {
    return jsonError(error);
  }
}
