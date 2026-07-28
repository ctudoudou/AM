import { z } from "zod";
import { assertTrustedMutationOrigin, jsonError, jsonResponse } from "@/lib/api";
import {
  assertKuraBuildRevision,
  BuildRevisionMismatchError,
} from "@/lib/build-info";
import { ORGANIZER_PLAN_EXECUTION_CONFIRMATION } from "@/lib/organizer-confirmations";
import {
  executeOrganizerPlan,
  OrganizerExecutionBusyError,
  OrganizerPlanStaleError,
} from "@/lib/organizer";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const executeSchema = z.object({
  confirmation: z.literal(ORGANIZER_PLAN_EXECUTION_CONFIRMATION),
  clientRevision: z.string().trim().min(1).max(128),
  planVersion: z.string().regex(/^[a-f0-9]{64}$/),
});

export async function POST(request: Request, context: RouteContext) {
  try {
    assertTrustedMutationOrigin(request);
    const { id } = await context.params;
    const input = executeSchema.parse(await request.json().catch(() => ({})));
    assertKuraBuildRevision(input.clientRevision);
    return jsonResponse(await executeOrganizerPlan(id, false, input.planVersion));
  } catch (error) {
    if (
      error instanceof BuildRevisionMismatchError ||
      error instanceof OrganizerPlanStaleError ||
      error instanceof OrganizerExecutionBusyError
    ) {
      return jsonResponse(
        {
          error:
            error instanceof BuildRevisionMismatchError
              ? "BUILD_REVISION_MISMATCH"
              : error instanceof OrganizerPlanStaleError
                ? "ORGANIZER_PLAN_STALE"
                : "ORGANIZER_EXECUTION_BUSY",
          message: error.message,
        },
        { status: 409 },
      );
    }
    return jsonError(error);
  }
}
