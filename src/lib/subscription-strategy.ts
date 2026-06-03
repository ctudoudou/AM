export type SubscriptionSeasonMode = "latest" | "specific" | "unknown_review";
export type SubscriptionEpisodeMode = "future_only" | "missing_only" | "range" | "all";
export type SubscriptionBatchPolicy = "reject" | "review" | "allow";

export type StrategyCandidate = {
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

export type SubscriptionStrategy = {
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

export type SubscriptionCandidateEvaluation = {
  candidate: StrategyCandidate;
  eligible: boolean;
  score: number;
  needsReview: boolean;
  reasons: string[];
  matchedPreferences: string[];
  rejectedBy: string[];
};

export type SubscriptionCandidateSelection = {
  candidate: StrategyCandidate | null;
  evaluation: SubscriptionCandidateEvaluation | null;
  needsReview: boolean;
  evaluations: SubscriptionCandidateEvaluation[];
};

const weightedPreferenceChecks = [
  ["preferredGroup", "subtitleGroup", 30],
  ["preferredSubtitleLanguage", "subtitleLanguage", 24],
  ["preferredResolution", "resolution", 18],
  ["preferredCodec", "codec", 14],
  ["preferredAudio", "audio", 10],
  ["preferredReleaseProfile", "releaseProfile", 8],
  ["preferredSourceKind", "sourceKind", 6],
] as const;

export function evaluateSubscriptionCandidate(
  candidate: StrategyCandidate,
  subscription: SubscriptionStrategy,
): SubscriptionCandidateEvaluation {
  const rejectedBy: string[] = [];
  const reasons: string[] = [];
  const matchedPreferences: string[] = [];
  const batch = candidateIsBatch(candidate);
  const batchPolicy = normalizeBatchPolicy(subscription.batchPolicy);

  if (batch && batchPolicy === "reject") {
    rejectedBy.push("batchPolicy");
    reasons.push("Batch release is rejected by the subscription strategy.");
  }

  const seasonMode = normalizeSeasonMode(subscription.seasonMode);
  if (seasonMode === "specific" && subscription.seasonNumber) {
    if (candidate.season !== null && candidate.season !== undefined && candidate.season !== subscription.seasonNumber) {
      rejectedBy.push("seasonNumber");
      reasons.push(`Candidate season ${candidate.season} does not match strategy season ${subscription.seasonNumber}.`);
    }
  }

  const episode = candidate.episodeNumber;
  if (episode !== null && episode !== undefined) {
    const start = positiveNumber(subscription.episodeStart);
    const end = positiveNumber(subscription.episodeEnd);
    if ((normalizeEpisodeMode(subscription.episodeMode) === "range" || start !== null) && start !== null && episode < start) {
      rejectedBy.push("episodeStart");
      reasons.push(`Candidate episode ${episode} is before strategy start ${start}.`);
    }
    if ((normalizeEpisodeMode(subscription.episodeMode) === "range" || end !== null) && end !== null && episode > end) {
      rejectedBy.push("episodeEnd");
      reasons.push(`Candidate episode ${episode} is after strategy end ${end}.`);
    }
  }

  for (const [preferredKey, candidateKey] of weightedPreferenceChecks) {
    const preferred = subscription[preferredKey];
    const actual = candidate[candidateKey];
    if (preferred && preferred !== actual) {
      rejectedBy.push(preferredKey);
      reasons.push(`${candidateKey} does not match preferred ${preferredKey}.`);
    }
  }

  if (subscription.preferredVariantKey && subscription.fallbackPolicy === "strict" && candidate.variantKey !== subscription.preferredVariantKey) {
    rejectedBy.push("preferredVariantKey");
    reasons.push("Strict fallback policy rejects a different release variant.");
  }

  if (rejectedBy.length > 0) {
    return {
      candidate,
      eligible: false,
      score: 0,
      needsReview: false,
      reasons,
      matchedPreferences,
      rejectedBy,
    };
  }

  let score = 1;
  if (subscription.preferredVariantKey && candidate.variantKey === subscription.preferredVariantKey) {
    score += 100;
    matchedPreferences.push("preferredVariantKey");
  }

  for (const [preferredKey, candidateKey, weight] of weightedPreferenceChecks) {
    const preferred = subscription[preferredKey];
    const actual = candidate[candidateKey];
    if (preferred && preferred === actual) {
      score += weight;
      matchedPreferences.push(preferredKey);
    }
  }

  const needsReview =
    (batch && batchPolicy === "review") ||
    (seasonMode === "specific" &&
      Boolean(subscription.seasonNumber) &&
      (candidate.season === null || candidate.season === undefined)) ||
    (subscription.fallbackPolicy === "manual_review" &&
      Boolean(subscription.preferredVariantKey) &&
      candidate.variantKey !== subscription.preferredVariantKey);

  if (batch && batchPolicy === "review") {
    reasons.push("Batch release is eligible but requires manual review.");
  }
  if (
    seasonMode === "specific" &&
    subscription.seasonNumber &&
    (candidate.season === null || candidate.season === undefined)
  ) {
    reasons.push("Candidate has no explicit season and must be reviewed for a specific-season strategy.");
  }
  if (
    subscription.fallbackPolicy === "manual_review" &&
    subscription.preferredVariantKey &&
    candidate.variantKey !== subscription.preferredVariantKey
  ) {
    reasons.push("Candidate differs from the preferred variant and fallback requires review.");
  }

  return {
    candidate,
    eligible: true,
    score,
    needsReview,
    reasons,
    matchedPreferences,
    rejectedBy,
  };
}

export function selectSubscriptionCandidate(
  candidates: StrategyCandidate[],
  subscription: SubscriptionStrategy,
): SubscriptionCandidateSelection {
  const evaluations = evaluateSubscriptionCandidates(candidates, subscription);
  const eligible = evaluations
    .filter((evaluation) => evaluation.eligible && evaluation.score > 0)
    .sort((a, b) => b.score - a.score || b.candidate.createdAt.getTime() - a.candidate.createdAt.getTime());
  const best = eligible[0];
  if (!best) {
    return { candidate: null, evaluation: null, needsReview: false, evaluations };
  }

  const second = eligible[1];
  const tiedDifferentVariant =
    Boolean(second) &&
    best.score === second.score &&
    best.candidate.variantKey !== second.candidate.variantKey;

  return {
    candidate: best.candidate,
    evaluation: {
      ...best,
      needsReview: best.needsReview || tiedDifferentVariant,
      reasons: tiedDifferentVariant
        ? [...best.reasons, "Top candidates tie with different release variants."]
        : best.reasons,
    },
    needsReview: best.needsReview || tiedDifferentVariant,
    evaluations,
  };
}

export function evaluateSubscriptionCandidates(
  candidates: StrategyCandidate[],
  subscription: SubscriptionStrategy,
) {
  return candidates.map((candidate) => evaluateSubscriptionCandidate(candidate, subscription));
}

export function scoreSubscriptionCandidate(
  candidate: StrategyCandidate,
  subscription: SubscriptionStrategy,
) {
  return evaluateSubscriptionCandidate(candidate, subscription).score;
}

export function candidateEligibleForSubscription(
  candidate: StrategyCandidate,
  subscription: SubscriptionStrategy,
) {
  return evaluateSubscriptionCandidate(candidate, subscription).eligible;
}

export function candidateIsBatch(candidate: StrategyCandidate) {
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
  const start = positiveNumber(match?.groups?.start);
  const end = positiveNumber(match?.groups?.end);
  return start && end && end > start ? { start, end } : null;
}

function normalizeSeasonMode(value: string | null | undefined): SubscriptionSeasonMode {
  return value === "latest" || value === "specific" ? value : "unknown_review";
}

function normalizeEpisodeMode(value: string | null | undefined): SubscriptionEpisodeMode {
  if (value === "missing_only" || value === "range" || value === "all") {
    return value;
  }
  return "future_only";
}

function normalizeBatchPolicy(value: string | null | undefined): SubscriptionBatchPolicy {
  if (value === "reject" || value === "allow") {
    return value;
  }
  return "review";
}

function positiveNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}
