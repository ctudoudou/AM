import { jsonError, jsonResponse } from "@/lib/api";
import { prepareHlsPlayback, stopHlsPlayback } from "@/lib/playback";

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

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return jsonResponse(await stopHlsPlayback(id));
  } catch (error) {
    return jsonError(error);
  }
}
