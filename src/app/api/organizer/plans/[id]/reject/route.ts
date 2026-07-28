import { assertTrustedMutationOrigin, jsonError, jsonResponse } from "@/lib/api";
import { OrganizerExecutionBusyError, rejectOrganizerPlan } from "@/lib/organizer";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    assertTrustedMutationOrigin(request);
    const { id } = await context.params;
    return jsonResponse(await rejectOrganizerPlan(id));
  } catch (error) {
    if (error instanceof OrganizerExecutionBusyError) {
      return jsonResponse(
        { error: "ORGANIZER_EXECUTION_BUSY", message: error.message },
        { status: 409 },
      );
    }
    return jsonError(error);
  }
}
