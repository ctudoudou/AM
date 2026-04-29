import { jsonError, jsonResponse } from "@/lib/api";
import { searchWantedEpisodeSources } from "@/lib/wanted-rss-search";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return jsonResponse(await searchWantedEpisodeSources(id));
  } catch (error) {
    return jsonError(error);
  }
}
