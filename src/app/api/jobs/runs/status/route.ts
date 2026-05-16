import { jsonError, jsonResponse } from "@/lib/api";
import { listJobRuns } from "@/lib/job-runs";
import { buildJobRunStatuses } from "./status";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const runs = await listJobRuns(120);
    return jsonResponse({
      statuses: buildJobRunStatuses(runs),
      recentRuns: runs.slice(0, 12),
    });
  } catch (error) {
    return jsonError(error);
  }
}
