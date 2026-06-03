import { prisma } from "@/lib/db";
import { enqueueCandidateDownload } from "@/lib/downloads";
import {
  scoreSubscriptionCandidate,
  selectSubscriptionCandidate as selectStrategySubscriptionCandidate,
  type StrategyCandidate,
  type SubscriptionStrategy,
} from "@/lib/subscription-strategy";

type MatchCandidate = StrategyCandidate;
type MatchSubscription = SubscriptionStrategy;

export async function matchSubscriptionsToCandidates() {
  const subscriptions = await prisma.subscription.findMany({
    where: {
      enabled: true,
      mediaType: { in: ["ANIME", "MOVIE", "TV"] },
      candidateGroupId: { not: null },
    },
  });
  let matched = 0;
  let enqueued = 0;

  for (const subscription of subscriptions) {
    if (!subscription.candidateGroupId) {
      continue;
    }

    if (subscription.mediaType === "MOVIE") {
      const alreadyQueued = await prisma.releaseCandidate.findFirst({
        where: {
          groupId: subscription.candidateGroupId,
          downloads: { some: {} },
        },
        select: { id: true },
      });
      if (alreadyQueued) {
        continue;
      }

      const candidates = await prisma.releaseCandidate.findMany({
        where: {
          groupId: subscription.candidateGroupId,
          status: { in: ["READY", "REVIEW"] },
          createdAt: { gt: subscription.createdAt },
        },
        orderBy: { createdAt: "desc" },
      });
      const selection = selectSubscriptionCandidate(candidates, subscription);
      if (!selection.candidate) {
        continue;
      }
      matched += 1;
      if (selection.needsReview) {
        await prisma.releaseCandidate.updateMany({
          where: { id: { in: candidates.map((candidate) => candidate.id) } },
          data: { status: "REVIEW" },
        });
        continue;
      }
      await prisma.releaseCandidate.update({
        where: { id: selection.candidate.id },
        data: { status: "SUBSCRIBED" },
      });
      if (subscription.autoDownload) {
        try {
          await enqueueCandidateDownload(selection.candidate.id);
          enqueued += 1;
        } catch {
          await prisma.releaseCandidate.update({
            where: { id: selection.candidate.id },
            data: { status: "REVIEW" },
          });
        }
      }
      continue;
    }

    const downloadedEpisodes = new Set(
      (
        await prisma.releaseCandidate.findMany({
          where: {
            groupId: subscription.candidateGroupId,
            downloads: { some: {} },
            episodeNumber: { not: null },
          },
          select: { episodeNumber: true },
        })
      )
        .map((candidate) => episodeKey(candidate.episodeNumber))
        .filter(Boolean),
    );

    const candidates = await prisma.releaseCandidate.findMany({
      where: {
        groupId: subscription.candidateGroupId,
        status: { in: ["READY", "REVIEW"] },
        episodeNumber: { not: null },
        createdAt: { gt: subscription.createdAt },
      },
      orderBy: [{ episodeNumber: "asc" }, { createdAt: "desc" }],
    });

    for (const episodeCandidates of groupCandidatesByEpisode(candidates)) {
      const key = episodeKey(episodeCandidates[0]?.episodeNumber ?? null);
      if (!key || downloadedEpisodes.has(key)) {
        continue;
      }

      const selection = selectSubscriptionCandidate(episodeCandidates, subscription);
      if (!selection.candidate) {
        continue;
      }

      matched += 1;
      if (selection.needsReview) {
        await prisma.releaseCandidate.updateMany({
          where: { id: { in: episodeCandidates.map((candidate) => candidate.id) } },
          data: { status: "REVIEW" },
        });
        continue;
      }

      await prisma.releaseCandidate.update({
        where: { id: selection.candidate.id },
        data: { status: "SUBSCRIBED" },
      });

      if (subscription.autoDownload) {
        try {
          await enqueueCandidateDownload(selection.candidate.id);
          enqueued += 1;
          downloadedEpisodes.add(key);
        } catch {
          await prisma.releaseCandidate.update({
            where: { id: selection.candidate.id },
            data: { status: "REVIEW" },
          });
        }
      }
    }
  }

  return { matched, enqueued };
}

export function selectSubscriptionCandidate(
  candidates: MatchCandidate[],
  subscription: MatchSubscription,
) {
  const selection = selectStrategySubscriptionCandidate(candidates, subscription);
  return { candidate: selection.candidate, needsReview: selection.needsReview };
}

export function scoreCandidate(
  candidate: MatchCandidate,
  subscription: MatchSubscription,
) {
  return scoreSubscriptionCandidate(candidate, subscription);
}

function groupCandidatesByEpisode(candidates: MatchCandidate[]) {
  const grouped = new Map<string, MatchCandidate[]>();
  for (const candidate of candidates) {
    const key = episodeKey(candidate.episodeNumber);
    if (!key) {
      continue;
    }
    grouped.set(key, [...(grouped.get(key) ?? []), candidate]);
  }
  return [...grouped.values()];
}

function episodeKey(episodeNumber: number | null) {
  if (episodeNumber === null || episodeNumber === undefined) {
    return null;
  }
  return episodeNumber.toFixed(3);
}
