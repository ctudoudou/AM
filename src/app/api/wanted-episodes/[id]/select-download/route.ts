import { z } from "zod";
import { jsonError, jsonResponse } from "@/lib/api";
import { selectWantedSearchResultForDownload } from "@/lib/wanted-rss-search";

export const dynamic = "force-dynamic";

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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const input = wantedSearchResultSchema.parse(await request.json());
    return jsonResponse(await selectWantedSearchResultForDownload(id, input), { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
