import { jsonError, jsonResponse } from "@/lib/api";
import { repairDataHealth, scanDataHealth } from "@/lib/data-health";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return jsonResponse(await scanDataHealth());
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST() {
  try {
    return jsonResponse(await repairDataHealth());
  } catch (error) {
    return jsonError(error);
  }
}
