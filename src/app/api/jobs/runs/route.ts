import { z } from "zod";
import { jsonError, jsonResponse } from "@/lib/api";
import { listJobRuns } from "@/lib/job-runs";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(120).default(50),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const input = querySchema.parse({
      limit: url.searchParams.get("limit") ?? undefined,
    });
    return jsonResponse({ runs: await listJobRuns(input.limit) });
  } catch (error) {
    return jsonError(error);
  }
}
