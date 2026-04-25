import { jsonError } from "@/lib/api";
import { createMediaStreamResponse } from "@/lib/playback";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return createMediaStreamResponse(id, request.headers.get("range"));
  } catch (error) {
    return jsonError(error);
  }
}
