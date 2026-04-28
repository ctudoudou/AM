import { describe, expect, it } from "vitest";
import { scoreCandidate, selectSubscriptionCandidate } from "./subscription-matcher";

const baseCandidate = {
  id: "candidate-1",
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

const baseSubscription = {
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

describe("subscription matching", () => {
  it("scores the selected release variant above compatible alternatives", () => {
    expect(scoreCandidate(baseCandidate, baseSubscription)).toBeGreaterThan(100);
    expect(
      scoreCandidate(
        {
          ...baseCandidate,
          id: "candidate-2",
          subtitleLanguage: "CHS",
          releaseProfile: "Baha / WEB-DL / CHS",
          variantKey: "ani|baha web dl chs|chs|baha|1080p|hevc|aac",
        },
        baseSubscription,
      ),
    ).toBe(0);
  });

  it("selects one candidate per episode by version score", () => {
    const selected = selectSubscriptionCandidate(
      [
        {
          ...baseCandidate,
          id: "candidate-older",
          createdAt: new Date("2026-04-24T00:00:00.000Z"),
        },
        {
          ...baseCandidate,
          id: "candidate-newer",
          createdAt: new Date("2026-04-25T00:00:00.000Z"),
        },
      ],
      baseSubscription,
    );

    expect(selected.candidate?.id).toBe("candidate-newer");
    expect(selected.needsReview).toBe(false);
  });

  it("requires manual review when two different variants tie", () => {
    const selected = selectSubscriptionCandidate(
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
        ...baseSubscription,
        preferredVariantKey: null,
      },
    );

    expect(selected.needsReview).toBe(true);
  });

  it("requires manual review when the stored preferred variant no longer matches", () => {
    const selected = selectSubscriptionCandidate(
      [
        {
          ...baseCandidate,
          variantKey: "ani|abema|1080p|hevc|aac",
          sourceKind: "ABEMA",
          releaseProfile: "ABEMA",
        },
      ],
      {
        ...baseSubscription,
        preferredVariantKey: "ani|legacy|hevc|aac",
        preferredSourceKind: null,
        preferredReleaseProfile: null,
      },
    );

    expect(selected.candidate?.variantKey).toBe("ani|abema|1080p|hevc|aac");
    expect(selected.needsReview).toBe(true);
  });
});
