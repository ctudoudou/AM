import { jsonError, jsonResponse } from "@/lib/api";
import { scanLibraryRoots } from "@/lib/library-scan";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    return jsonResponse(await scanLibraryRoots(), { status: 202 });
  } catch (error) {
    return jsonError(error);
  }
}
