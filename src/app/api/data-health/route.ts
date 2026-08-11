import { z } from "zod";
import { assertTrustedMutationOrigin, jsonError, jsonResponse } from "@/lib/api";
import {
  createDataHealthRepairPlan,
  DATA_HEALTH_REPAIR_CONFIRMATION,
  DataHealthRepairPlanStaleError,
  DataHealthRepairValidationError,
  repairDataHealth,
  scanDataHealth,
} from "@/lib/data-health";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return jsonResponse(await scanDataHealth());
  } catch (error) {
    return jsonError(error);
  }
}

const repairRequestSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("preview") }),
  z.object({
    mode: z.literal("execute"),
    planId: z.string().length(64),
    actionIds: z.array(
      z.enum(["candidate_groups", "organizer_plans", "movie_metadata_aliases"]),
    ).min(1).max(3),
    confirmation: z.literal(DATA_HEALTH_REPAIR_CONFIRMATION),
  }),
]);

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const input = repairRequestSchema.parse(await request.json());
    return jsonResponse(
      input.mode === "preview"
        ? await createDataHealthRepairPlan()
        : await repairDataHealth(input),
    );
  } catch (error) {
    if (error instanceof DataHealthRepairPlanStaleError) {
      return jsonResponse(
        { error: "STALE_DATA_HEALTH_REPAIR_PLAN", message: error.message },
        { status: 409 },
      );
    }
    if (error instanceof DataHealthRepairValidationError) {
      return jsonResponse(
        { error: "INVALID_DATA_HEALTH_REPAIR_PLAN", message: error.message },
        { status: 400 },
      );
    }
    return jsonError(error);
  }
}
