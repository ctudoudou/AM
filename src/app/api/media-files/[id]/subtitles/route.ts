import { jsonError, jsonResponse } from "@/lib/api";
import { listSubtitleTracks } from "@/lib/subtitles";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return jsonResponse({ tracks: await listSubtitleTracks(id) });
  } catch (error) {
    return jsonError(error);
  }
}
