import { z } from "zod";
import { jsonError, jsonResponse } from "@/lib/api";
import { searchHistoryBackfill } from "@/lib/history-backfill";

export const dynamic = "force-dynamic";

const searchSchema = z.object({
  seasonNumber: z.coerce.number().int().positive(),
  episodeStart: z.coerce.number().int().positive(),
  episodeEnd: z.coerce.number().int().positive(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const input = searchSchema.parse(await request.json());
    return jsonResponse(await searchHistoryBackfill({ mediaTitleId: id, ...input }));
  } catch (error) {
    return jsonError(error);
  }
}
