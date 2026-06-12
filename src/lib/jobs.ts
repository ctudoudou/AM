import { fetchAllRssSources, parseNewRssItems } from "@/lib/rss-fetcher";
import { groupUngroupedCandidates, repairCandidateGroups } from "@/lib/candidate-grouper";
import { syncAria2Downloads } from "@/lib/downloads";
import { matchSubscriptionsToCandidates } from "@/lib/subscription-matcher";
import {
  autoExecuteReadyOrganizerPlans,
  cleanupPollutedOrganizerPlans,
  cleanupStaleOrganizerPlans,
  inspectCompletedDownloads,
  reviewOrganizerPlansWithAi,
} from "@/lib/organizer";
import { scanLibraryRoots } from "@/lib/library-scan";
import { mergeDuplicateAnimeTitles, mergeDuplicateTvTitles } from "@/lib/media-title-repair";
import { cleanupNoisyMovieMetadataAliases } from "@/lib/metadata";
import { repairAnimeEpisodeNumbering } from "@/lib/wanted-episodes";

export const jobNames = [
  "rss.fetchAll",
  "rss.parseItems",
  "ai.groupCandidates",
  "ai.repairCandidateGroups",
  "subscriptions.matchNewCandidates",
  "downloads.syncAria2",
  "organizer.inspectCompletedDownloads",
  "organizer.cleanupPollutedPlans",
  "organizer.cleanupStalePlans",
  "organizer.aiReviewPlans",
  "organizer.autoExecuteReadyPlans",
  "library.scan",
  "library.cleanupMovieMetadataAliases",
  "library.mergeDuplicateAnimeTitles",
  "library.mergeDuplicateTvTitles",
  "library.repairEpisodeNumbering",
] as const;

export type JobName = (typeof jobNames)[number];

export async function runJob(name: JobName) {
  switch (name) {
    case "rss.fetchAll": {
      const fetched = await fetchAllRssSources();
      const parsed = await parseNewRssItems();
      const grouped = await groupUngroupedCandidates(1000);
      const matched = await matchSubscriptionsToCandidates();
      return { fetched, parsed, grouped, matched };
    }
    case "rss.parseItems":
      return parseNewRssItems();
    case "ai.groupCandidates":
      return groupUngroupedCandidates(1000);
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
    case "organizer.cleanupStalePlans":
      return cleanupStaleOrganizerPlans();
    case "organizer.aiReviewPlans":
      return reviewOrganizerPlansWithAi();
    case "organizer.autoExecuteReadyPlans":
      return autoExecuteReadyOrganizerPlans();
    case "library.scan":
      return scanLibraryRoots();
    case "library.cleanupMovieMetadataAliases":
      return cleanupNoisyMovieMetadataAliases();
    case "library.mergeDuplicateAnimeTitles":
      return mergeDuplicateAnimeTitles();
    case "library.mergeDuplicateTvTitles":
      return mergeDuplicateTvTitles();
    case "library.repairEpisodeNumbering":
      return repairAnimeEpisodeNumbering();
  }
}
