import { jsonError, jsonResponse } from "@/lib/api";
import { auditAnimeLibrary } from "@/lib/library-audit";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return jsonResponse(await auditAnimeLibrary());
  } catch (error) {
    return jsonError(error);
  }
}
