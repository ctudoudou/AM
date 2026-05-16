export type SubscriptionQueueState =
  | "ACTIONABLE"
  | "REVIEW_REQUIRED"
  | "SUBSCRIBED"
  | "EMPTY";

export type SubscriptionQueueReason =
  | "readyToSubscribe"
  | "needsReview"
  | "alreadySubscribed"
  | "noVersions";

export type SubscriptionQueueDescription = {
  state: SubscriptionQueueState;
  reason: SubscriptionQueueReason;
  canSubscribeVersion: boolean;
};

export function describeSubscriptionQueueGroup(input: {
  candidateCount: number;
  reviewRequired: boolean;
  enabledSubscriptionCount: number;
}): SubscriptionQueueDescription {
  if (input.enabledSubscriptionCount > 0) {
    return {
      state: "SUBSCRIBED",
      reason: "alreadySubscribed",
      canSubscribeVersion: false,
    };
  }

  if (input.candidateCount === 0) {
    return {
      state: "EMPTY",
      reason: "noVersions",
      canSubscribeVersion: false,
    };
  }

  if (input.reviewRequired) {
    return {
      state: "REVIEW_REQUIRED",
      reason: "needsReview",
      canSubscribeVersion: true,
    };
  }

  return {
    state: "ACTIONABLE",
    reason: "readyToSubscribe",
    canSubscribeVersion: true,
  };
}
