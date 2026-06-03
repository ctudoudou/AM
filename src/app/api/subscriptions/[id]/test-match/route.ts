import { z } from "zod";
import { jsonError, jsonResponse } from "@/lib/api";
import { prisma } from "@/lib/db";
import { evaluateSubscriptionCandidates, selectSubscriptionCandidate } from "@/lib/subscription-strategy";

const testMatchSchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(80),
  includeRejected: z.boolean().default(true),
});

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const input = testMatchSchema.parse(body);
    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { id },
      include: {
        candidateGroup: {
          include: {
            candidates: {
              orderBy: [{ episodeNumber: "asc" }, { createdAt: "desc" }],
              take: input.limit,
            },
          },
        },
      },
    });
    const candidates = subscription.candidateGroup?.candidates ?? [];
    const evaluations = evaluateSubscriptionCandidates(candidates, subscription);
    const selection = selectSubscriptionCandidate(candidates, subscription);

    return jsonResponse({
      subscriptionId: subscription.id,
      candidateGroupId: subscription.candidateGroupId,
      selectedCandidateId: selection.candidate?.id ?? null,
      needsReview: selection.needsReview,
      evaluations: (input.includeRejected ? evaluations : evaluations.filter((item) => item.eligible))
        .map((evaluation) => ({
          candidateId: evaluation.candidate.id,
          rawTitle: evaluation.candidate.rawTitle,
          season: evaluation.candidate.season,
          episodeNumber: evaluation.candidate.episodeNumber,
          variantKey: evaluation.candidate.variantKey,
          eligible: evaluation.eligible,
          score: evaluation.score,
          needsReview:
            selection.candidate?.id === evaluation.candidate.id
              ? selection.needsReview
              : evaluation.needsReview,
          reasons:
            selection.candidate?.id === evaluation.candidate.id && selection.evaluation
              ? selection.evaluation.reasons
              : evaluation.reasons,
          matchedPreferences: evaluation.matchedPreferences,
          rejectedBy: evaluation.rejectedBy,
        })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
