import { z } from "zod";
import { assertTrustedMutationOrigin, jsonError, jsonResponse } from "@/lib/api";
import { videoSourceErrorResponse } from "@/lib/video-sources/api";
import { queueVideoSourceImports } from "@/lib/video-sources/imports";

const importSchema = z.object({
  url: z.string().trim().url().max(2_048),
  planId: z.string().regex(/^[a-f0-9]{64}$/),
  episodeKeys: z.array(z.string().trim().min(1).max(128)).min(1).max(24),
});

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const input = importSchema.parse(await request.json());
    return jsonResponse(await queueVideoSourceImports(input), { status: 201 });
  } catch (error) {
    return videoSourceErrorResponse(error) ?? jsonError(error);
  }
}
