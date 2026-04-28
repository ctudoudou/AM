import { prisma } from "@/lib/db";
import { enqueueCandidateDownload } from "@/lib/downloads";

type MatchCandidate = {
  id: string;
  episodeNumber: number | null;
  subtitleGroup: string | null;
  resolution: string | null;
  codec: string | null;
  audio: string | null;
  subtitleLanguage: string | null;
  releaseProfile: string | null;
  sourceKind: string | null;
  variantKey: string | null;
  createdAt: Date;
};

type MatchSubscription = {
  preferredGroup: string | null;
  preferredResolution: string | null;
  preferredCodec: string | null;
  preferredAudio: string | null;
  preferredSubtitleLanguage: string | null;
  preferredReleaseProfile: string | null;
  preferredSourceKind: string | null;
  preferredVariantKey: string | null;
  fallbackPolicy: string;
};

export async function matchSubscriptionsToCandidates() {
  const subscriptions = await prisma.subscription.findMany({
    where: {
      enabled: true,
      mediaType: { in: ["ANIME", "TV"] },
      candidateGroupId: { not: null },
    },
  });
  let matched = 0;
  let enqueued = 0;

  for (const subscription of subscriptions) {
    if (!subscription.candidateGroupId) {
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
  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(candidate, subscription),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.candidate.createdAt.getTime() - a.candidate.createdAt.getTime());

  const best = scored[0];
  if (!best) {
    return { candidate: null, needsReview: false };
  }

  const second = scored[1];
  const needsReview =
    (subscription.fallbackPolicy === "manual_review" &&
      Boolean(subscription.preferredVariantKey) &&
      best.candidate.variantKey !== subscription.preferredVariantKey) ||
    Boolean(second) &&
    best.score === second.score &&
    best.candidate.variantKey !== second.candidate.variantKey;

  return { candidate: best.candidate, needsReview };
}

export function scoreCandidate(
  candidate: MatchCandidate,
  subscription: MatchSubscription,
) {
  const requiredChecks = [
    [subscription.preferredGroup, candidate.subtitleGroup],
    [subscription.preferredResolution, candidate.resolution],
    [subscription.preferredCodec, candidate.codec],
    [subscription.preferredAudio, candidate.audio],
    [subscription.preferredSubtitleLanguage, candidate.subtitleLanguage],
    [subscription.preferredReleaseProfile, candidate.releaseProfile],
    [subscription.preferredSourceKind, candidate.sourceKind],
  ] as const;

  for (const [preferred, actual] of requiredChecks) {
    if (preferred && preferred !== actual) {
      return 0;
    }
  }

  let score = 1;
  if (subscription.preferredVariantKey && candidate.variantKey === subscription.preferredVariantKey) {
    score += 100;
  } else if (subscription.fallbackPolicy === "strict" && subscription.preferredVariantKey) {
    return 0;
  }

  for (const [preferred, actual] of requiredChecks) {
    if (preferred && preferred === actual) {
      score += 10;
    }
  }

  return score;
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
