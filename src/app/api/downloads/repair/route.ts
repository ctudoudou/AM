import { z } from "zod";
import { jsonError, jsonResponse } from "@/lib/api";
import {
  createDownloadRepairPlan,
  DOWNLOAD_REPAIR_CONFIRMATION,
  DownloadRepairPlanStaleError,
  DownloadRepairValidationError,
  executeDownloadRepairPlan,
} from "@/lib/download-repair";

export const dynamic = "force-dynamic";

const executeSchema = z.object({
  planId: z.string().length(64),
  actionIds: z.array(z.string().min(1)).min(1).max(200),
  confirmation: z.literal(DOWNLOAD_REPAIR_CONFIRMATION),
});

export async function GET() {
  try {
    return jsonResponse(await createDownloadRepairPlan());
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    return jsonResponse(await executeDownloadRepairPlan(executeSchema.parse(await request.json())));
  } catch (error) {
    if (error instanceof DownloadRepairPlanStaleError) {
      return jsonResponse(
        { error: "STALE_DOWNLOAD_REPAIR_PLAN", message: error.message },
        { status: 409 },
      );
    }
    if (error instanceof DownloadRepairValidationError) {
      return jsonResponse(
        { error: "INVALID_DOWNLOAD_REPAIR_PLAN", message: error.message },
        { status: 400 },
      );
    }
    return jsonError(error);
  }
}
