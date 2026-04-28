import { jsonError, jsonResponse } from "@/lib/api";
import { getAnimeEpisodeCoverage } from "@/lib/wanted-episodes";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return jsonResponse(await getAnimeEpisodeCoverage(id));
  } catch (error) {
    return jsonError(error);
  }
}
