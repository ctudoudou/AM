import { jsonError, jsonResponse } from "@/lib/api";
import { getPlaybackDescriptor } from "@/lib/playback";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return jsonResponse(await getPlaybackDescriptor(id));
  } catch (error) {
    return jsonError(error);
  }
}
