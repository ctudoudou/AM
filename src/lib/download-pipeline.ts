export type DownloadPipelineInput = {
  status: string;
  archiveStatus?: string | null;
  organizerPlans?: Array<{ status: string; reason?: string | null }>;
};

export type PipelineStageState = "waiting" | "active" | "done" | "blocked";

export type DownloadPipeline = {
  download: PipelineStageState;
  organizer: PipelineStageState;
  library: PipelineStageState;
  blockedReason: string | null;
};

const blockedOrganizerStatuses = new Set(["NEEDS_REVIEW", "REJECTED", "CONFLICT", "FAILED"]);
const completedOrganizerStatuses = new Set(["AUTO_ARCHIVED", "EXECUTED"]);

export function buildDownloadPipeline(input: DownloadPipelineInput): DownloadPipeline {
  const latestPlan = input.organizerPlans?.[0];
  const download = input.status === "FAILED"
    ? "blocked"
    : input.status === "COMPLETED"
      ? "done"
      : "active";

  if (download !== "done") {
    return {
      download,
      organizer: "waiting",
      library: "waiting",
      blockedReason: download === "blocked" ? "download_failed" : null,
    };
  }

  if (!latestPlan) {
    return {
      download,
      organizer: "active",
      library: "waiting",
      blockedReason: null,
    };
  }

  if (blockedOrganizerStatuses.has(latestPlan.status)) {
    return {
      download,
      organizer: "blocked",
      library: "waiting",
      blockedReason: latestPlan.reason || latestPlan.status.toLowerCase(),
    };
  }

  if (completedOrganizerStatuses.has(latestPlan.status) || input.archiveStatus === "archived") {
    return {
      download,
      organizer: "done",
      library: "done",
      blockedReason: null,
    };
  }

  return {
    download,
    organizer: "active",
    library: "waiting",
    blockedReason: null,
  };
}
