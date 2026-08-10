import { assertTrustedMutationOrigin, jsonError, jsonResponse } from "@/lib/api";
import {
  OrganizerAiReviewError,
  reviewOrganizerPlanWithAi,
} from "@/lib/organizer";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    assertTrustedMutationOrigin(request);
    const { id } = await context.params;
    return jsonResponse(await reviewOrganizerPlanWithAi(id));
  } catch (error) {
    if (error instanceof OrganizerAiReviewError) {
      return jsonResponse(
        { error: error.code, message: error.message },
        { status: error.code === "ORGANIZER_AI_REVIEW_UNAVAILABLE" ? 503 : 409 },
      );
    }
    return jsonError(error);
  }
}
