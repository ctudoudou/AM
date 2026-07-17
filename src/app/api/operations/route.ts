import { z } from "zod";
import { jsonError, jsonResponse } from "@/lib/api";
import { listOperationLogs } from "@/lib/operation-log";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  domain: z.enum(["DOWNLOAD", "ORGANIZER"]).optional(),
  status: z.enum(["STARTED", "SUCCEEDED", "FAILED", "ROLLED_BACK"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = querySchema.parse({
      domain: url.searchParams.get("domain") || undefined,
      status: url.searchParams.get("status") || undefined,
      limit: url.searchParams.get("limit") || undefined,
    });
    return jsonResponse({ operations: await listOperationLogs(query) });
  } catch (error) {
    return jsonError(error);
  }
}
