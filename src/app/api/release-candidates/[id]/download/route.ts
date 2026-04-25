import { jsonError, jsonResponse } from "@/lib/api";
import { enqueueCandidateDownload } from "@/lib/downloads";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    return jsonResponse(await enqueueCandidateDownload(id), { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
