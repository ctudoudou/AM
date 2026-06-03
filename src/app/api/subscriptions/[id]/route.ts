import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, jsonResponse } from "@/lib/api";
import { prisma } from "@/lib/db";

const subscriptionPatchSchema = z.object({
  seasonMode: z.enum(["latest", "specific", "unknown_review"]).optional(),
  seasonNumber: z.coerce.number().int().positive().nullable().optional(),
  episodeMode: z.enum(["future_only", "missing_only", "range", "all"]).optional(),
  episodeStart: z.coerce.number().positive().nullable().optional(),
  episodeEnd: z.coerce.number().positive().nullable().optional(),
  batchPolicy: z.enum(["reject", "review", "allow"]).optional(),
  preferredGroup: z.string().nullable().optional(),
  preferredResolution: z.string().nullable().optional(),
  preferredCodec: z.string().nullable().optional(),
  preferredAudio: z.string().nullable().optional(),
  preferredSubtitleLanguage: z.string().nullable().optional(),
  preferredReleaseProfile: z.string().nullable().optional(),
  preferredSourceKind: z.string().nullable().optional(),
  preferredVariantKey: z.string().nullable().optional(),
  autoDownload: z.boolean().optional(),
  enabled: z.boolean().optional(),
  fallbackPolicy: z.string().optional(),
}).refine((input) => {
  if (input.episodeStart && input.episodeEnd) {
    return input.episodeEnd >= input.episodeStart;
  }
  return true;
}, {
  message: "episodeEnd must be greater than or equal to episodeStart",
});

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const input = subscriptionPatchSchema.parse(await request.json());
    const subscription = await prisma.subscription.update({
      where: { id },
      data: input,
    });
    return jsonResponse(subscription);
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    await prisma.subscription.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return jsonError(error);
  }
}
