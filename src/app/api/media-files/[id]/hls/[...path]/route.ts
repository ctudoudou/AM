import { jsonError } from "@/lib/api";
import { createHlsAssetResponse } from "@/lib/playback";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; path: string[] }> },
) {
  try {
    const { id, path } = await params;
    return createHlsAssetResponse(id, path);
  } catch (error) {
    return jsonError(error);
  }
}
