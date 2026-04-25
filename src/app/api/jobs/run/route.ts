import { z } from "zod";
import { jsonError, jsonResponse } from "@/lib/api";
import { jobNames, runJob } from "@/lib/jobs";

const runJobSchema = z.object({
  job: z.enum(jobNames),
});

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { job } = runJobSchema.parse(await request.json());
    return jsonResponse({ job, result: await runJob(job) });
  } catch (error) {
    return jsonError(error);
  }
}
