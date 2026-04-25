import { z } from "zod";
import { jsonError, jsonResponse } from "@/lib/api";
import { prisma } from "@/lib/db";
import { enqueueCandidateDownload } from "@/lib/downloads";

const subscriptionCreateSchema = z.object({
  candidateId: z.string().min(1).optional(),
  candidateGroupId: z.string().min(1).optional(),
  preferredGroup: z.string().optional(),
  preferredResolution: z.string().optional(),
  preferredCodec: z.string().optional(),
  preferredAudio: z.string().optional(),
  preferredSubtitleLanguage: z.string().optional(),
  preferredReleaseProfile: z.string().optional(),
  preferredSourceKind: z.string().optional(),
  preferredVariantKey: z.string().optional(),
  autoDownload: z.boolean().default(false),
  fallbackPolicy: z.string().default("manual_review"),
}).refine((input) => input.candidateId || input.candidateGroupId, {
  message: "candidateId or candidateGroupId is required",
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
    const subscription = await prisma.subscription.create({
      data: {
        candidateGroupId: group.id,
        title: group.displayTitle,
        preferredGroup: input.preferredGroup ?? selectedCandidate?.subtitleGroup,
        preferredResolution: input.preferredResolution ?? selectedCandidate?.resolution,
        preferredCodec: input.preferredCodec ?? selectedCandidate?.codec,
        preferredAudio: input.preferredAudio ?? selectedCandidate?.audio,
        preferredSubtitleLanguage:
          input.preferredSubtitleLanguage ?? selectedCandidate?.subtitleLanguage,
        preferredReleaseProfile:
          input.preferredReleaseProfile ?? selectedCandidate?.releaseProfile,
        preferredSourceKind: input.preferredSourceKind ?? selectedCandidate?.sourceKind,
        preferredVariantKey: input.preferredVariantKey ?? selectedCandidate?.variantKey,
        fallbackPolicy: input.fallbackPolicy,
        autoDownload: input.autoDownload,
      },
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

    return jsonResponse({ subscription, downloadError }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
