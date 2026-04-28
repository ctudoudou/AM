import { jsonError, jsonResponse } from "@/lib/api";
import { ignoreWantedEpisode } from "@/lib/wanted-episodes";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return jsonResponse(await ignoreWantedEpisode(id));
  } catch (error) {
    return jsonError(error);
  }
}
