import { jsonError, jsonResponse } from "@/lib/api";
import { prepareHlsPlayback } from "@/lib/playback";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return jsonResponse(await prepareHlsPlayback(id), { status: 202 });
  } catch (error) {
    return jsonError(error);
  }
}
