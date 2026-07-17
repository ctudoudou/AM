import { z } from "zod";
import { assertTrustedMutationOrigin, jsonError, jsonResponse } from "@/lib/api";
import {
  createOrganizerRepairPlan,
  executeOrganizerRepairPlan,
  ORGANIZER_REPAIR_CONFIRMATION,
  OrganizerRepairPlanStaleError,
  OrganizerRepairValidationError,
} from "@/lib/organizer-repair";

export const dynamic = "force-dynamic";

const executeSchema = z.object({
  planId: z.string().length(64),
  actionIds: z.array(z.string().min(1)).min(1).max(200),
  confirmation: z.literal(ORGANIZER_REPAIR_CONFIRMATION),
});

export async function GET() {
  try {
    return jsonResponse(await createOrganizerRepairPlan());
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    return jsonResponse(await executeOrganizerRepairPlan(executeSchema.parse(await request.json())));
  } catch (error) {
    if (error instanceof OrganizerRepairPlanStaleError) {
      return jsonResponse(
        { error: "STALE_ORGANIZER_REPAIR_PLAN", message: error.message },
        { status: 409 },
      );
    }
    if (error instanceof OrganizerRepairValidationError) {
      return jsonResponse(
        { error: "INVALID_ORGANIZER_REPAIR_PLAN", message: error.message },
        { status: 400 },
      );
    }
    return jsonError(error);
  }
}
