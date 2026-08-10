import type { MediaType } from "@prisma/client";
import { z } from "zod";
import { jsonError, jsonResponse } from "@/lib/api";
import { prisma } from "@/lib/db";
import { enqueueCandidateDownload } from "@/lib/downloads";
import {
  candidateGroupIdentityInput,
  subscriptionCoversCandidateGroup,
  type SubscriptionCoverageInput,
} from "@/lib/media-identity";
import { assertSubscriptionReviewGate } from "@/lib/subscription-review-gate";

const subscriptionCreateSchema = z.object({
  candidateId: z.string().min(1).optional(),
  candidateGroupId: z.string().min(1).optional(),
  seasonMode: z.enum(["latest", "specific", "unknown_review"]).optional(),
  seasonNumber: z.coerce.number().int().positive().optional().nullable(),
  episodeMode: z.enum(["future_only", "missing_only", "range", "all"]).optional(),
  episodeStart: z.coerce.number().positive().optional().nullable(),
  episodeEnd: z.coerce.number().positive().optional().nullable(),
  batchPolicy: z.enum(["reject", "review", "allow"]).optional(),
  preferredGroup: z.string().optional(),
  preferredResolution: z.string().optional(),
  preferredCodec: z.string().optional(),
  preferredAudio: z.string().optional(),
  preferredSubtitleLanguage: z.string().optional(),
  preferredReleaseProfile: z.string().optional(),
  preferredSourceKind: z.string().optional(),
  preferredVariantKey: z.string().optional(),
  autoDownload: z.boolean().default(false),
  reviewConfirmed: z.boolean().default(false),
  fallbackPolicy: z.string().default("manual_review"),
}).refine((input) => input.candidateId || input.candidateGroupId, {
  message: "candidateId or candidateGroupId is required",
}).refine((input) => {
  if (input.episodeStart && input.episodeEnd) {
    return input.episodeEnd >= input.episodeStart;
  }
  return true;
}, {
  message: "episodeEnd must be greater than or equal to episodeStart",
});

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const subscriptions = await prisma.subscription.findMany({
      orderBy: { updatedAt: "desc" },
      include: { candidateGroup: true },
    });
    return jsonResponse({ subscriptions });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = subscriptionCreateSchema.parse(await request.json());
    const selectedCandidate = input.candidateId
      ? await prisma.releaseCandidate.findUniqueOrThrow({
          where: { id: input.candidateId },
          include: { group: true },
        })
      : null;
    const candidateGroupId = selectedCandidate?.groupId ?? input.candidateGroupId;
    if (!candidateGroupId) {
      throw new Error("Selected candidate is not grouped yet");
    }
    const group =
      selectedCandidate?.group ??
      (await prisma.releaseCandidateGroup.findUniqueOrThrow({
        where: { id: candidateGroupId },
      }));
    assertSubscriptionReviewGate({
      autoDownload: input.autoDownload,
      candidateStatus: selectedCandidate?.status,
      groupReviewRequired: group.reviewRequired,
      reviewConfirmed: input.reviewConfirmed,
    });
    const seasonNumber = input.seasonNumber ?? selectedCandidate?.season ?? group.season ?? null;
    const seasonMode = input.seasonMode ?? (seasonNumber ? "specific" : "unknown_review");
    const episodeStart = input.episodeStart ?? selectedCandidate?.episodeNumber ?? null;
    const episodeEnd = input.episodeEnd ?? null;
    const episodeMode = input.episodeMode ?? "future_only";
    const preferredVariantKey = input.preferredVariantKey ?? selectedCandidate?.variantKey ?? null;
    const strategyWhere = {
      seasonMode,
      seasonNumber,
      episodeMode,
      episodeStart,
      episodeEnd,
      preferredVariantKey,
    };
    const exactSubscription = await prisma.subscription.findFirst({
      where: {
        candidateGroupId: group.id,
        ...strategyWhere,
      },
      orderBy: { updatedAt: "desc" },
      include: { candidateGroup: true },
    });
    const existingSubscription =
      exactSubscription ??
      (await findCanonicalSubscription({
        mediaType: group.mediaType,
        strategyWhere,
        group,
      }));
    const targetGroup = existingSubscription?.candidateGroup ?? group;
    const subscriptionData = {
      candidateGroupId: targetGroup.id,
      mediaType: targetGroup.mediaType,
      title: targetGroup.displayTitle,
      seasonMode,
      seasonNumber,
      episodeMode,
      episodeStart,
      episodeEnd,
      batchPolicy: input.batchPolicy ?? "review",
      preferredGroup: input.preferredGroup ?? selectedCandidate?.subtitleGroup,
      preferredResolution: input.preferredResolution ?? selectedCandidate?.resolution,
      preferredCodec: input.preferredCodec ?? selectedCandidate?.codec,
      preferredAudio: input.preferredAudio ?? selectedCandidate?.audio,
      preferredSubtitleLanguage:
        input.preferredSubtitleLanguage ?? selectedCandidate?.subtitleLanguage,
      preferredReleaseProfile:
        input.preferredReleaseProfile ?? selectedCandidate?.releaseProfile,
      preferredSourceKind: input.preferredSourceKind ?? selectedCandidate?.sourceKind,
      preferredVariantKey,
      fallbackPolicy: input.fallbackPolicy,
      autoDownload: input.autoDownload,
      enabled: true,
    };
    const subscription = existingSubscription
      ? await prisma.subscription.update({
          where: { id: existingSubscription.id },
          data: subscriptionData,
        })
      : await prisma.subscription.create({
          data: subscriptionData,
        });

    if (selectedCandidate) {
      await prisma.releaseCandidate.update({
        where: { id: selectedCandidate.id },
        data: { status: "SUBSCRIBED" },
      });
    }

    let downloadError: string | undefined;
    if (selectedCandidate && input.autoDownload) {
      const existingDownload = await prisma.download.findFirst({
        where: { candidateId: selectedCandidate.id },
      });
      if (!existingDownload) {
        try {
          await enqueueCandidateDownload(selectedCandidate.id);
        } catch (error) {
          downloadError =
            error instanceof Error ? error.message : "Failed to enqueue selected candidate";
          await prisma.releaseCandidate.update({
            where: { id: selectedCandidate.id },
            data: { status: "REVIEW" },
          });
        }
      }
    }

    return jsonResponse(
      { subscription, downloadError, replaced: Boolean(existingSubscription) },
      { status: existingSubscription ? 200 : 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}

async function findCanonicalSubscription(input: {
  mediaType: MediaType;
  strategyWhere: {
    seasonMode: string;
    seasonNumber: number | null;
    episodeMode: string;
    episodeStart: number | null;
    episodeEnd: number | null;
    preferredVariantKey: string | null;
  };
  group: {
    id: string;
    mediaType: MediaType;
    displayTitle: string;
    normalizedTitle: string;
    aliases?: unknown;
    season?: number | null;
  };
}) {
  const subscriptions = await prisma.subscription.findMany({
    where: {
      enabled: true,
      mediaType: input.mediaType,
      ...input.strategyWhere,
    },
    include: { candidateGroup: true },
    orderBy: { updatedAt: "desc" },
  });

  return subscriptions.find((subscription) =>
    subscription.candidateGroup &&
    subscriptionCoversCandidateGroup(
      subscriptionCoverageInput(subscription),
      candidateGroupCoverageInput(input.group),
    ),
  );
}

function subscriptionCoverageInput(subscription: {
  mediaType: string;
  title: string;
  seasonMode?: string | null;
  seasonNumber?: number | null;
  candidateGroup?: {
    mediaType: string;
    displayTitle: string;
    normalizedTitle: string;
    aliases?: unknown;
    season?: number | null;
  } | null;
}): SubscriptionCoverageInput {
  return {
    mediaType: subscription.mediaType,
    title: subscription.title,
    seasonMode: subscription.seasonMode,
    seasonNumber: subscription.seasonNumber,
    candidateGroup: subscription.candidateGroup
      ? candidateGroupCoverageInput(subscription.candidateGroup)
      : null,
  };
}

function candidateGroupCoverageInput(group: {
  mediaType: string;
  displayTitle: string;
  normalizedTitle: string;
  aliases?: unknown;
  season?: number | null;
}) {
  return candidateGroupIdentityInput({ ...group, season: group.season ?? null });
}
