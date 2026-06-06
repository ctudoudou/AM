import { z } from "zod";
import { jsonError, jsonResponse } from "@/lib/api";
import { translateSubtitleTrack } from "@/lib/subtitles";

export const dynamic = "force-dynamic";

const translateSchema = z.object({
  targetLanguage: z.enum(["zh-Hans", "zh-Hant"]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const input = translateSchema.parse(await request.json());
    return jsonResponse(await translateSubtitleTrack(id, input.targetLanguage), { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
