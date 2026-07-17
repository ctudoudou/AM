import { jsonError, jsonResponse } from "@/lib/api";
import { createDownloadReconciliationPlan } from "@/lib/download-reconciliation";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return jsonResponse(await createDownloadReconciliationPlan());
  } catch (error) {
    return jsonError(error);
  }
}
