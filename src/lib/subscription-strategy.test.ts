import { describe, expect, it } from "vitest";
import {
  evaluateSubscriptionCandidate,
  selectSubscriptionCandidate,
} from "./subscription-strategy";

const baseCandidate = {
  id: "candidate-1",
  mediaType: "ANIME",
  rawTitle: "[ANi] Example Anime - 01 [1080P][CHT]",
  season: 1,
  episodeNumber: 1,
  subtitleGroup: "ANi",
  resolution: "1080p",
  codec: "HEVC",
  audio: "AAC",
  subtitleLanguage: "CHT",
  releaseProfile: "Baha / WEB-DL / CHT",
  sourceKind: "Baha",
  variantKey: "ani|baha web dl cht|cht|baha|1080p|hevc|aac",
  createdAt: new Date("2026-04-25T00:00:00.000Z"),
};

const baseStrategy = {
  seasonMode: "specific",
  seasonNumber: 1,
  episodeMode: "range",
  episodeStart: 1,
  episodeEnd: 12,
  batchPolicy: "review",
  preferredGroup: "ANi",
  preferredResolution: "1080p",
  preferredCodec: "HEVC",
  preferredAudio: "AAC",
  preferredSubtitleLanguage: "CHT",
  preferredReleaseProfile: "Baha / WEB-DL / CHT",
  preferredSourceKind: "Baha",
  preferredVariantKey: "ani|baha web dl cht|cht|baha|1080p|hevc|aac",
  fallbackPolicy: "manual_review",
};

describe("subscription strategy evaluation", () => {
  it("explains matched strategy preferences", () => {
    const evaluation = evaluateSubscriptionCandidate(baseCandidate, baseStrategy);

    expect(evaluation).toMatchObject({
      eligible: true,
      needsReview: false,
      rejectedBy: [],
    });
    expect(evaluation.score).toBeGreaterThan(100);
    expect(evaluation.matchedPreferences).toContain("preferredVariantKey");
    expect(evaluation.matchedPreferences).toContain("preferredResolution");
  });

  it("explains hard eligibility rejections", () => {
    const evaluation = evaluateSubscriptionCandidate(
      {
        ...baseCandidate,
        season: 2,
        episodeNumber: 13,
      },
      baseStrategy,
    );

    expect(evaluation.eligible).toBe(false);
    expect(evaluation.score).toBe(0);
    expect(evaluation.rejectedBy).toEqual(expect.arrayContaining(["seasonNumber", "episodeEnd"]));
    expect(evaluation.reasons.join(" ")).toContain("strategy season 1");
  });

  it("surfaces review when top variants tie", () => {
    const selection = selectSubscriptionCandidate(
      [
        {
          ...baseCandidate,
          variantKey: "variant-a",
        },
        {
          ...baseCandidate,
          id: "candidate-2",
          variantKey: "variant-b",
        },
      ],
      {
        ...baseStrategy,
        preferredVariantKey: null,
      },
    );

    expect(selection.needsReview).toBe(true);
    expect(selection.evaluation?.reasons.join(" ")).toContain("tie");
  });
});
