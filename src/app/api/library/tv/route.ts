import { jsonError, jsonResponse } from "@/lib/api";
import { getMediaLibrary } from "@/lib/media-library";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return jsonResponse({ titles: await getMediaLibrary("TV") });
  } catch (error) {
    return jsonError(error);
  }
}
