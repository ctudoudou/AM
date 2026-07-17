import { assertTrustedMutationOrigin, jsonError, jsonResponse } from "@/lib/api";
import { rejectOrganizerPlan } from "@/lib/organizer";

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
    return jsonError(error);
  }
}
