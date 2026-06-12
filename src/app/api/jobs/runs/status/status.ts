import type { listJobRuns } from "@/lib/job-runs";
import type { JobName } from "@/lib/jobs";

type JobRun = Awaited<ReturnType<typeof listJobRuns>>[number];

const statusGroups = [
  {
    key: "rss",
    jobs: ["rss.fetchAll", "rss.parseItems", "subscriptions.matchNewCandidates"],
  },
  {
    key: "downloads",
    jobs: ["downloads.syncAria2"],
  },
  {
    key: "organizerScan",
    jobs: [
      "organizer.inspectCompletedDownloads",
      "organizer.cleanupPollutedPlans",
      "organizer.cleanupStalePlans",
      "library.scan",
      "library.cleanupMovieMetadataAliases",
      "library.mergeDuplicateTvTitles",
    ],
  },
  {
    key: "aiReview",
    jobs: ["ai.groupCandidates", "ai.repairCandidateGroups", "organizer.aiReviewPlans"],
  },
  {
    key: "autoArchive",
    jobs: ["organizer.autoExecuteReadyPlans"],
  },
] as const satisfies ReadonlyArray<{ key: string; jobs: readonly JobName[] }>;

export type JobRunStatus = {
  key: (typeof statusGroups)[number]["key"];
  jobs: JobName[];
  state: JobRun["status"] | "NEVER";
  latestRun: JobRun | null;
};

export function buildJobRunStatuses(runs: JobRun[]): JobRunStatus[] {
  return statusGroups.map((group) => {
    const jobs: readonly JobName[] = group.jobs;
    const latestRun =
      runs.find((run) => jobs.includes(run.job)) ?? null;

    return {
      key: group.key,
      jobs: [...group.jobs],
      state: latestRun?.status ?? "NEVER",
      latestRun,
    };
  });
}
