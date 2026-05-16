import { describe, expect, it } from "vitest";
import { buildJobRunStatuses } from "./status";

const baseRun = {
  id: "run-1",
  status: "SUCCESS" as const,
  startedAt: "2026-05-16T00:00:00.000Z",
  finishedAt: "2026-05-16T00:00:01.000Z",
  durationMs: 1000,
};

describe("buildJobRunStatuses", () => {
  it("maps recent runs into observable task groups", () => {
    const runs: Parameters<typeof buildJobRunStatuses>[0] = [
      { ...baseRun, id: "download", job: "downloads.syncAria2" },
      {
        ...baseRun,
        id: "rss",
        job: "rss.fetchAll",
        status: "FAILED",
        error: "feed unavailable",
      },
      { ...baseRun, id: "ai", job: "organizer.aiReviewPlans" },
    ];
    const statuses = buildJobRunStatuses(runs);

    expect(statuses).toMatchObject([
      { key: "rss", state: "FAILED", latestRun: { id: "rss" } },
      { key: "downloads", state: "SUCCESS", latestRun: { id: "download" } },
      { key: "organizerScan", state: "NEVER", latestRun: null },
      { key: "aiReview", state: "SUCCESS", latestRun: { id: "ai" } },
      { key: "autoArchive", state: "NEVER", latestRun: null },
    ]);
  });
});
