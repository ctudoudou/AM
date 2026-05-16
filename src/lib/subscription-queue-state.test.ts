import { describe, expect, it } from "vitest";
import { describeSubscriptionQueueGroup } from "./subscription-queue-state";

describe("describeSubscriptionQueueGroup", () => {
  it("marks ready groups as actionable", () => {
    expect(
      describeSubscriptionQueueGroup({
        candidateCount: 3,
        enabledSubscriptionCount: 0,
        reviewRequired: false,
      }),
    ).toEqual({
      state: "ACTIONABLE",
      reason: "readyToSubscribe",
      canSubscribeVersion: true,
    });
  });

  it("explains groups blocked by review", () => {
    expect(
      describeSubscriptionQueueGroup({
        candidateCount: 1,
        enabledSubscriptionCount: 0,
        reviewRequired: true,
      }).reason,
    ).toBe("needsReview");
  });

  it("prioritizes active subscriptions over empty version state", () => {
    expect(
      describeSubscriptionQueueGroup({
        candidateCount: 0,
        enabledSubscriptionCount: 1,
        reviewRequired: false,
      }),
    ).toMatchObject({
      state: "SUBSCRIBED",
      reason: "alreadySubscribed",
      canSubscribeVersion: false,
    });
  });

  it("explains groups with no current versions", () => {
    expect(
      describeSubscriptionQueueGroup({
        candidateCount: 0,
        enabledSubscriptionCount: 0,
        reviewRequired: false,
      }).state,
    ).toBe("EMPTY");
  });
});
