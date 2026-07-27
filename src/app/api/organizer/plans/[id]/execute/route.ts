import { z } from "zod";
import { assertTrustedMutationOrigin, jsonError, jsonResponse } from "@/lib/api";
import { ORGANIZER_PLAN_EXECUTION_CONFIRMATION } from "@/lib/organizer-confirmations";
import { executeOrganizerPlan } from "@/lib/organizer";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const executeSchema = z.object({
  confirmation: z.literal(ORGANIZER_PLAN_EXECUTION_CONFIRMATION),
});

export async function POST(request: Request, context: RouteContext) {
  try {
    assertTrustedMutationOrigin(request);
    const { id } = await context.params;
    executeSchema.parse(await request.json().catch(() => ({})));
    return jsonResponse(await executeOrganizerPlan(id));
  } catch (error) {
    return jsonError(error);
  }
}
