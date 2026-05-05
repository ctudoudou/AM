import { jsonError } from "@/lib/api";
import { createSubtitleTrackResponse } from "@/lib/subtitles";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return createSubtitleTrackResponse(id);
  } catch (error) {
    return jsonError(error);
  }
}
