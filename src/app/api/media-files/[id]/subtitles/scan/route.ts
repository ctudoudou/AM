import { jsonError, jsonResponse } from "@/lib/api";
import { discoverSubtitleTracks } from "@/lib/subtitles";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return jsonResponse(await discoverSubtitleTracks(id), { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
