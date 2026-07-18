import { z } from "zod";
import { assertTrustedMutationOrigin, jsonError, jsonResponse } from "@/lib/api";
import { videoSourceErrorResponse } from "@/lib/video-sources/api";
import { inspectVideoSource } from "@/lib/video-sources/registry";

const inspectSchema = z.object({
  url: z.string().trim().url().max(2_048),
});

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const input = inspectSchema.parse(await request.json());
    return jsonResponse(await inspectVideoSource(input.url));
  } catch (error) {
    return videoSourceErrorResponse(error) ?? jsonError(error);
  }
}
