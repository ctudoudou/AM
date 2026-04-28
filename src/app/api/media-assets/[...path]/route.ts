import { jsonError } from "@/lib/api";
import { createMediaAssetResponse } from "@/lib/media-assets";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path } = await params;
    return createMediaAssetResponse(path);
  } catch (error) {
    return jsonError(error);
  }
}
