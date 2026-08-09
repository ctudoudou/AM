import { describe, expect, it } from "vitest";
import {
  assertCandidateReadyForDownload,
  assertSubscriptionReviewGate,
  SubscriptionReviewGateError,
  subscriptionCandidateNeedsReview,
} from "./subscription-review-gate";

describe("subscription review gate", () => {
  it("treats either group or candidate review state as requiring confirmation", () => {
    expect(
      subscriptionCandidateNeedsReview({ candidateStatus: "READY", groupReviewRequired: true }),
    ).toBe(true);
    expect(
      subscriptionCandidateNeedsReview({ candidateStatus: "REVIEW", groupReviewRequired: false }),
    ).toBe(true);
    expect(
      subscriptionCandidateNeedsReview({ candidateStatus: "READY", groupReviewRequired: false }),
    ).toBe(false);
  });

  it("requires explicit confirmation and keeps automatic download disabled", () => {
    expect(() =>
      assertSubscriptionReviewGate({
        autoDownload: false,
        candidateStatus: "REVIEW",
        groupReviewRequired: false,
        reviewConfirmed: false,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<SubscriptionReviewGateError>>({
        code: "REVIEW_CONFIRMATION_REQUIRED",
      }),
    );

    expect(() =>
      assertSubscriptionReviewGate({
        autoDownload: true,
        candidateStatus: "REVIEW",
        groupReviewRequired: false,
        reviewConfirmed: true,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<SubscriptionReviewGateError>>({
        code: "REVIEW_AUTO_DOWNLOAD_BLOCKED",
      }),
    );
  });

  it("blocks direct downloads until both candidate and group are ready", () => {
    expect(() =>
      assertCandidateReadyForDownload({
        candidateStatus: "READY",
        groupReviewRequired: true,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<SubscriptionReviewGateError>>({
        code: "CANDIDATE_NOT_READY",
      }),
    );
    expect(() =>
      assertCandidateReadyForDownload({
        candidateStatus: "READY",
        groupReviewRequired: false,
      }),
    ).not.toThrow();
  });
});
