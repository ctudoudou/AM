import { prisma } from "@/lib/db";
import { enqueueCandidateDownload } from "@/lib/downloads";

type MatchCandidate = {
  id: string;
  mediaType?: string | null;
  rawTitle?: string | null;
  episodeNumber: number | null;
  season?: number | null;
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
  seasonMode?: string | null;
  seasonNumber?: number | null;
  episodeMode?: string | null;
  episodeStart?: number | null;
  episodeEnd?: number | null;
  batchPolicy?: string | null;
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
    candidateNeedsStrategyReview(best.candidate, subscription) ||
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
  if (!candidateEligibleForSubscription(candidate, subscription)) {
    return 0;
  }

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

export function candidateEligibleForSubscription(
  candidate: MatchCandidate,
  subscription: MatchSubscription,
) {
  const batchPolicy = subscription.batchPolicy ?? "review";
  if (candidateIsBatch(candidate) && batchPolicy === "reject") {
    return false;
  }

  const seasonMode = subscription.seasonMode ?? "unknown_review";
  if (seasonMode === "specific" && subscription.seasonNumber) {
    if (candidate.season !== null && candidate.season !== undefined && candidate.season !== subscription.seasonNumber) {
      return false;
    }
  }

  const episode = candidate.episodeNumber;
  if (episode !== null && episode !== undefined) {
    const start = subscription.episodeStart;
    const end = subscription.episodeEnd;
    if (
      (subscription.episodeMode === "range" || (start !== null && start !== undefined)) &&
      start &&
      episode < start
    ) {
      return false;
    }
    if (
      (subscription.episodeMode === "range" || (end !== null && end !== undefined)) &&
      end &&
      episode > end
    ) {
      return false;
    }
  }

  return true;
}

function candidateNeedsStrategyReview(
  candidate: MatchCandidate,
  subscription: MatchSubscription,
) {
  if (candidateIsBatch(candidate) && (subscription.batchPolicy ?? "review") === "review") {
    return true;
  }
  if (
    (subscription.seasonMode ?? "unknown_review") === "specific" &&
    subscription.seasonNumber &&
    (candidate.season === null || candidate.season === undefined)
  ) {
    return true;
  }
  return false;
}

function candidateIsBatch(candidate: MatchCandidate) {
  if (candidate.mediaType === "MOVIE") {
    return false;
  }
  if (candidate.episodeNumber === null || candidate.episodeNumber === undefined) {
    return true;
  }
  return Boolean(candidate.rawTitle && extractEpisodeRange(candidate.rawTitle));
}

function extractEpisodeRange(value: string) {
  const match = value.match(
    /(?:^|[\s[\]()【】_-])(?<start>\d{1,3})\s*[-~～]\s*(?<end>\d{1,3})(?:\s*(?:fin|end|complete|合集|全集|全|完|完结|完結))?(?=$|[\s[\]()【】_-])/i,
  );
  const start = positiveInteger(match?.groups?.start);
  const end = positiveInteger(match?.groups?.end);
  return start && end && end > start ? { start, end } : null;
}

function positiveInteger(value: unknown) {
  const number = typeof value === "number" ? Math.floor(value) : Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
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
