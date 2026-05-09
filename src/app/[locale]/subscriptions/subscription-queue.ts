export type QueueCandidate = {
  createdAt?: string | Date | null;
  sourceKind?: string | null;
};

export type QueueCandidateGroup = {
  id: string;
  confidence: number;
  reviewRequired: boolean;
  candidates: QueueCandidate[];
};

export type CandidateQueueSort = "LATEST" | "UNSUBSCRIBED" | "VERSIONS" | "REVIEW";

export function sortCandidateGroupsForQueue<T extends QueueCandidateGroup>(
  groups: T[],
  sort: CandidateQueueSort,
  subscriptionGroupIds: Set<string>,
) {
  return [...groups].sort((a, b) => {
    if (sort === "UNSUBSCRIBED") {
      const aSubscribed = subscriptionGroupIds.has(a.id) ? 1 : 0;
      const bSubscribed = subscriptionGroupIds.has(b.id) ? 1 : 0;
      return (
        aSubscribed - bSubscribed ||
        latestCandidateTime(b) - latestCandidateTime(a) ||
        b.candidates.length - a.candidates.length ||
        b.confidence - a.confidence
      );
    }

    if (sort === "VERSIONS") {
      return (
        b.candidates.length - a.candidates.length ||
        latestCandidateTime(b) - latestCandidateTime(a) ||
        b.confidence - a.confidence
      );
    }

    if (sort === "REVIEW") {
      return (
        Number(b.reviewRequired) - Number(a.reviewRequired) ||
        latestCandidateTime(b) - latestCandidateTime(a) ||
        b.candidates.length - a.candidates.length ||
        b.confidence - a.confidence
      );
    }

    return (
      latestCandidateTime(b) - latestCandidateTime(a) ||
      b.candidates.length - a.candidates.length ||
      b.confidence - a.confidence
    );
  });
}

export function summarizeCandidateGroupFreshness(group: QueueCandidateGroup) {
  const latest = group.candidates.reduce<QueueCandidate | null>((current, candidate) => {
    if (!current) {
      return candidate;
    }
    return candidateTime(candidate.createdAt) > candidateTime(current.createdAt)
      ? candidate
      : current;
  }, null);

  if (!latest) {
    return null;
  }

  return {
    sourceKind: latest.sourceKind ?? null,
    createdAt: latest.createdAt ?? null,
  };
}

function latestCandidateTime(group: QueueCandidateGroup) {
  return group.candidates.reduce(
    (latest, candidate) => Math.max(latest, candidateTime(candidate.createdAt)),
    0,
  );
}

function candidateTime(value?: string | Date | null) {
  if (!value) {
    return 0;
  }
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}
