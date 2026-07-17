import { z } from "zod";
import { assertTrustedMutationOrigin, jsonError, jsonResponse } from "@/lib/api";
import {
  createDownloadReconciliationPlan,
  DOWNLOAD_RECONCILIATION_CONFIRMATION,
  DownloadReconciliationPlanStaleError,
  DownloadReconciliationValidationError,
  executeDownloadReconciliationPlan,
} from "@/lib/download-reconciliation";

export const dynamic = "force-dynamic";

const executeSchema = z.object({
  planId: z.string().length(64),
  actionIds: z.array(z.string().min(1)).min(1).max(100),
  confirmation: z.literal(DOWNLOAD_RECONCILIATION_CONFIRMATION),
});

export async function GET() {
  try {
    return jsonResponse(await createDownloadReconciliationPlan());
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    return jsonResponse(
      await executeDownloadReconciliationPlan(executeSchema.parse(await request.json())),
    );
  } catch (error) {
    if (error instanceof DownloadReconciliationPlanStaleError) {
      return jsonResponse(
        { error: "STALE_DOWNLOAD_RECONCILIATION_PLAN", message: error.message },
        { status: 409 },
      );
    }
    if (error instanceof DownloadReconciliationValidationError) {
      return jsonResponse(
        { error: "INVALID_DOWNLOAD_RECONCILIATION_PLAN", message: error.message },
        { status: 400 },
      );
    }
    return jsonError(error);
  }
}
