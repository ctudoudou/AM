import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { runJob, type JobName } from "@/lib/jobs";

const JOB_RUNS_KEY = "jobRuns";
const MAX_JOB_RUNS = 120;

export type JobRunRecord = {
  id: string;
  job: JobName;
  status: "SUCCESS" | "FAILED";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  result?: unknown;
  error?: string;
};

export async function runJobWithLog(
  name: JobName,
  options: { shouldLogSuccess?: (result: unknown) => boolean } = {},
) {
  const started = new Date();
  try {
    const result = await runJob(name);
    if (options.shouldLogSuccess?.(result) ?? true) {
      await appendJobRun({
        id: createRunId(name, started),
        job: name,
        status: "SUCCESS",
        startedAt: started.toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - started.getTime(),
        result: summarizeJobResult(result),
      });
    }
    return result;
  } catch (error) {
    await appendJobRun({
      id: createRunId(name, started),
      job: name,
      status: "FAILED",
      startedAt: started.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started.getTime(),
      error: error instanceof Error ? error.message : "Unexpected job error",
    });
    throw error;
  }
}

export async function listJobRuns(limit = 50) {
  const runs = await readJobRuns();
  return runs.slice(0, Math.min(Math.max(limit, 1), MAX_JOB_RUNS));
}

async function appendJobRun(record: JobRunRecord) {
  const current = await readJobRuns();
  const next = [record, ...current].slice(0, MAX_JOB_RUNS);
  await prisma.appSetting.upsert({
    where: { key: JOB_RUNS_KEY },
    create: {
      key: JOB_RUNS_KEY,
      value: next as Prisma.InputJsonValue,
    },
    update: {
      value: next as Prisma.InputJsonValue,
    },
  });
}

async function readJobRuns(): Promise<JobRunRecord[]> {
  const row = await prisma.appSetting.findUnique({
    where: { key: JOB_RUNS_KEY },
  });
  return normalizeJobRuns(row?.value);
}

function normalizeJobRuns(value: unknown): JobRunRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is JobRunRecord => {
    if (!item || typeof item !== "object") {
      return false;
    }
    const record = item as Partial<JobRunRecord>;
    return (
      typeof record.id === "string" &&
      typeof record.job === "string" &&
      (record.status === "SUCCESS" || record.status === "FAILED") &&
      typeof record.startedAt === "string" &&
      typeof record.finishedAt === "string" &&
      typeof record.durationMs === "number"
    );
  });
}

function createRunId(name: JobName, started: Date) {
  return `${name}:${started.toISOString()}:${Math.random().toString(36).slice(2, 8)}`;
}

function summarizeJobResult(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return { count: value.length };
  }
  const entries = Object.entries(value as Record<string, unknown>);
  return Object.fromEntries(
    entries.map(([key, entry]) => {
      if (Array.isArray(entry)) {
        return [key, { count: entry.length }];
      }
      if (entry && typeof entry === "object") {
        return [key, summarizeNestedObject(entry as Record<string, unknown>)];
      }
      return [key, toJsonSafeValue(entry)];
    }),
  );
}

function summarizeNestedObject(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      Array.isArray(entry) ? { count: entry.length } : toJsonSafeValue(entry),
    ]),
  );
}

function toJsonSafeValue(value: unknown) {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}
