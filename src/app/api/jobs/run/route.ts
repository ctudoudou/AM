import { z } from "zod";
import { jsonError, jsonResponse } from "@/lib/api";
import { jobNames } from "@/lib/jobs";
import { runJobWithLog } from "@/lib/job-runs";

const runJobSchema = z.object({
  job: z.enum(jobNames),
});

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { job } = runJobSchema.parse(await request.json());
    return jsonResponse({ job, result: await runJobWithLog(job) });
  } catch (error) {
    return jsonError(error);
  }
}
