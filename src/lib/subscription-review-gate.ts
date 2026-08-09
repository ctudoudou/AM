const directlyDownloadableCandidateStatuses = new Set(["READY", "SUBSCRIBED"]);

export type SubscriptionReviewGateCode =
  | "REVIEW_CONFIRMATION_REQUIRED"
  | "REVIEW_AUTO_DOWNLOAD_BLOCKED"
  | "CANDIDATE_NOT_READY";

export class SubscriptionReviewGateError extends Error {
  constructor(
    readonly code: SubscriptionReviewGateCode,
    message: string,
  ) {
    super(message);
    this.name = "SubscriptionReviewGateError";
  }
}

export function subscriptionCandidateNeedsReview(input: {
  candidateStatus?: string | null;
  groupReviewRequired: boolean;
}) {
  return input.groupReviewRequired || input.candidateStatus === "NEW" || input.candidateStatus === "REVIEW";
}

export function assertSubscriptionReviewGate(input: {
  autoDownload: boolean;
  candidateStatus?: string | null;
  groupReviewRequired: boolean;
  reviewConfirmed: boolean;
}) {
  if (!subscriptionCandidateNeedsReview(input)) {
    return;
  }
  if (!input.reviewConfirmed) {
    throw new SubscriptionReviewGateError(
      "REVIEW_CONFIRMATION_REQUIRED",
      "This candidate or title group requires explicit review before subscribing.",
    );
  }
  if (input.autoDownload) {
    throw new SubscriptionReviewGateError(
      "REVIEW_AUTO_DOWNLOAD_BLOCKED",
      "Candidates that require review cannot be downloaded automatically.",
    );
  }
}

export function assertCandidateReadyForDownload(input: {
  candidateStatus: string;
  groupReviewRequired: boolean;
}) {
  if (
    input.groupReviewRequired ||
    !directlyDownloadableCandidateStatuses.has(input.candidateStatus)
  ) {
    throw new SubscriptionReviewGateError(
      "CANDIDATE_NOT_READY",
      "This candidate must pass review before it can be downloaded.",
    );
  }
}
