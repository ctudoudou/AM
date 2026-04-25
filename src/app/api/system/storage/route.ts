import { jsonError, jsonResponse } from "@/lib/api";
import { getStorageSummary } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return jsonResponse(await getStorageSummary());
  } catch (error) {
    return jsonError(error);
  }
}
