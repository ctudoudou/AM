import { fetchAllRssSources, parseNewRssItems } from "@/lib/rss-fetcher";
import { groupUngroupedCandidates, repairCandidateGroups } from "@/lib/candidate-grouper";
import { syncAria2Downloads } from "@/lib/downloads";
import { matchSubscriptionsToCandidates } from "@/lib/subscription-matcher";
import { cleanupPollutedOrganizerPlans, inspectCompletedDownloads } from "@/lib/organizer";
import { scanLibraryRoots } from "@/lib/library-scan";

export const jobNames = [
  "rss.fetchAll",
  "rss.parseItems",
  "ai.groupCandidates",
  "ai.repairCandidateGroups",
  "subscriptions.matchNewCandidates",
  "downloads.syncAria2",
  "organizer.inspectCompletedDownloads",
  "organizer.cleanupPollutedPlans",
  "library.scan",
] as const;

export type JobName = (typeof jobNames)[number];

export async function runJob(name: JobName) {
  switch (name) {
    case "rss.fetchAll": {
      const fetched = await fetchAllRssSources();
      const parsed = await parseNewRssItems();
      const grouped = await groupUngroupedCandidates(200, { regroupExisting: true });
      const matched = await matchSubscriptionsToCandidates();
      return { fetched, parsed, grouped, matched };
    }
    case "rss.parseItems":
      return parseNewRssItems();
    case "ai.groupCandidates":
      return groupUngroupedCandidates(200, { regroupExisting: true });
    case "ai.repairCandidateGroups":
      return repairCandidateGroups(200);
    case "subscriptions.matchNewCandidates":
      return matchSubscriptionsToCandidates();
    case "downloads.syncAria2":
      return syncAria2Downloads();
    case "organizer.inspectCompletedDownloads":
      return inspectCompletedDownloads();
    case "organizer.cleanupPollutedPlans":
      return cleanupPollutedOrganizerPlans();
    case "library.scan":
      return scanLibraryRoots();
  }
}
