import { z } from "zod";
import { assertTrustedMutationOrigin, jsonError, jsonResponse } from "@/lib/api";
import { scanImportDirectory } from "@/lib/import-scan";
import { normalizeIntakeMediaType } from "@/lib/media-parser";
import { getAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

const importScanSchema = z.object({
  root: z.string().trim().optional(),
  mediaType: z.enum(["ANIME", "MOVIE", "TV", "AUTO"]).default("AUTO"),
});

export async function POST(request: Request) {
  try {
    assertTrustedMutationOrigin(request);
    const input = importScanSchema.parse(await request.json());
    const settings = await getAppSettings();
    return jsonResponse(
      await scanImportDirectory({
        root: input.root || settings.directories.importRoot,
        mediaType: normalizeIntakeMediaType(input.mediaType),
      }),
      { status: 202 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
