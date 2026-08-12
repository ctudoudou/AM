import { z } from "zod";
import { assertTrustedMutationOrigin, jsonError, jsonResponse } from "@/lib/api";
import { ORGANIZER_AI_CLASSIFICATION_CONFIRMATION } from "@/lib/organizer-confirmations";
import {
  applyOrganizerAiClassification,
  OrganizerAiReviewError,
  OrganizerPlanStaleError,
} from "@/lib/organizer";

const applySchema = z.object({
  confirmation: z.literal(ORGANIZER_AI_CLASSIFICATION_CONFIRMATION),
  planVersion: z.string().length(64),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertTrustedMutationOrigin(request);
    const [{ id }, input] = await Promise.all([
      context.params,
      request.json().then((body) => applySchema.parse(body)),
    ]);
    return jsonResponse(
      await applyOrganizerAiClassification({
        planId: id,
        expectedVersion: input.planVersion,
        confirmation: input.confirmation,
      }),
    );
  } catch (error) {
    if (error instanceof OrganizerPlanStaleError) {
      return jsonResponse(
        { error: "STALE_ORGANIZER_PLAN", message: error.message },
        { status: 409 },
      );
    }
    if (error instanceof OrganizerAiReviewError) {
      return jsonResponse(
        { error: error.code, message: error.message },
        { status: 409 },
      );
    }
    return jsonError(error);
  }
}
