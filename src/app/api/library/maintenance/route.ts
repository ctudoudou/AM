import { z } from "zod";
import { jsonError, jsonResponse } from "@/lib/api";
import { repairMediaLibrary } from "@/lib/media-library-maintenance";
import { refreshMediaLibraryMetadata } from "@/lib/metadata";

export const dynamic = "force-dynamic";

const maintenanceSchema = z.object({
  action: z.enum(["repair", "refreshMetadata"]),
  mediaType: z.enum(["MOVIE", "TV"]),
});

export async function POST(request: Request) {
  try {
    const input = maintenanceSchema.parse(await request.json().catch(() => ({})));
    const result = input.action === "repair"
      ? await repairMediaLibrary(input.mediaType)
      : await refreshMediaLibraryMetadata({ mediaType: input.mediaType, onlyMissing: true });
    return jsonResponse({ action: input.action, mediaType: input.mediaType, result });
  } catch (error) {
    return jsonError(error);
  }
}
