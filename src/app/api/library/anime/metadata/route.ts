import { z } from "zod";
import { jsonError, jsonResponse } from "@/lib/api";
import { refreshAnimeLibraryMetadata } from "@/lib/metadata";

export const dynamic = "force-dynamic";

const refreshSchema = z.object({
  titleId: z.string().optional(),
  onlyMissing: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const input = refreshSchema.parse(body);
    return jsonResponse(await refreshAnimeLibraryMetadata(input));
  } catch (error) {
    return jsonError(error);
  }
}
