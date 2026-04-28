import { z } from "zod";
import { jsonError, jsonResponse } from "@/lib/api";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const titleDisplaySchema = z.object({
  titleDisplayMode: z.enum(["GLOBAL", "ZH_HANT", "ZH_HANS", "JA", "EN", "CUSTOM"]),
  customDisplayTitle: z.string().trim().max(200).optional().nullable(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const input = titleDisplaySchema.parse(await request.json());
    const customDisplayTitle =
      input.titleDisplayMode === "CUSTOM" ? input.customDisplayTitle?.trim() : null;
    if (input.titleDisplayMode === "CUSTOM" && !customDisplayTitle) {
      return jsonResponse(
        { error: "VALIDATION_ERROR", message: "Custom title is required." },
        { status: 400 },
      );
    }

    const result = await prisma.mediaTitle.updateMany({
      where: { id, type: "ANIME" },
      data: {
        titleDisplayMode: input.titleDisplayMode,
        customDisplayTitle,
      },
    });
    if (result.count === 0) {
      return jsonResponse({ error: "NOT_FOUND", message: "Anime title not found." }, { status: 404 });
    }
    const media = await prisma.mediaTitle.findUniqueOrThrow({ where: { id } });

    return jsonResponse({ media });
  } catch (error) {
    return jsonError(error);
  }
}
