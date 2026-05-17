import { jsonError, jsonResponse } from "@/lib/api";
import { regenerateRejectedOrganizerPlan } from "@/lib/organizer";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    return jsonResponse(await regenerateRejectedOrganizerPlan(id));
  } catch (error) {
    return jsonError(error);
  }
}
