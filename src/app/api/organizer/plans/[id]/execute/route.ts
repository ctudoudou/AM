import { assertTrustedMutationOrigin, jsonError, jsonResponse } from "@/lib/api";
import { executeOrganizerPlan } from "@/lib/organizer";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    assertTrustedMutationOrigin(request);
    const { id } = await context.params;
    return jsonResponse(await executeOrganizerPlan(id));
  } catch (error) {
    return jsonError(error);
  }
}
