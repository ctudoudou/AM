import { jsonError, jsonResponse } from "@/lib/api";
import { createManualTorrentIntake } from "@/lib/intake";
import { normalizeIntakeMediaType } from "@/lib/media-parser";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const title = String(form.get("title") ?? "");
    const mediaType = normalizeIntakeMediaType(form.get("mediaType"));

    if (!(file instanceof File)) {
      return jsonResponse(
        { error: "TORRENT_FILE_REQUIRED", message: "Torrent file is required" },
        { status: 400 },
      );
    }

    return jsonResponse(
      await createManualTorrentIntake({
        title,
        mediaType,
        fileName: file.name,
        bytes: await file.arrayBuffer(),
      }),
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
