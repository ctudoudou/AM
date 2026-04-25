import { z } from "zod";
import { jsonError, jsonResponse } from "@/lib/api";
import { prisma } from "@/lib/db";

const progressSchema = z.object({
  episodeId: z.string().min(1),
  positionSec: z.coerce.number().int().min(0),
  durationSec: z.coerce.number().int().positive().optional(),
});

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  try {
    const input = progressSchema.parse(await request.json());
    const completed = input.durationSec
      ? input.positionSec / input.durationSec >= 0.9
      : false;
    const progress = await prisma.watchProgress.upsert({
      where: { episodeId: input.episodeId },
      create: {
        episodeId: input.episodeId,
        positionSec: input.positionSec,
        durationSec: input.durationSec,
        completed,
      },
      update: {
        positionSec: input.positionSec,
        durationSec: input.durationSec,
        completed,
      },
    });
    return jsonResponse(progress);
  } catch (error) {
    return jsonError(error);
  }
}
