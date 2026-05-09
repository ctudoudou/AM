import { describe, expect, it } from "vitest";
import { normalizeCandidateEpisodeNumber, parseReleaseWithNormalizedEpisode } from "./episode-normalizer";

describe("episode normalizer", () => {
  it("infers cumulative episode offsets from sibling season candidates", () => {
    const candidates = [
      { rawTitle: "出租女友 第五季 - 03", normalizedTitle: "出租女友", season: 5, episodeNumber: 3 },
      { rawTitle: "出租女友 第五季 - 04", normalizedTitle: "出租女友", season: 5, episodeNumber: 4 },
      { rawTitle: "出租女友 第五季 - 05", normalizedTitle: "出租女友", season: 5, episodeNumber: 5 },
      { rawTitle: "出租女友 第五季 - 51", normalizedTitle: "出租女友", season: 5, episodeNumber: 51 },
      { rawTitle: "出租女友 第五季 - 52", normalizedTitle: "出租女友", season: 5, episodeNumber: 52 },
      { rawTitle: "出租女友 第五季 - 53", normalizedTitle: "出租女友", season: 5, episodeNumber: 53 },
    ];

    expect(normalizeCandidateEpisodeNumber(candidates[4], candidates)).toMatchObject({
      season: 5,
      episodeNumber: 4,
      rawEpisodeNumber: 52,
      offset: 48,
    });
  });

  it("normalizes second-cour numbering without title-specific rules", () => {
    const parsed = parseReleaseWithNormalizedEpisode(
      "[Group] Dr.STONE SCIENCE FUTURE 第2クール - 13 [1080p]",
    );

    expect(parsed.season).toBe(2);
    expect(parsed.episodeNumber).toBe(1);
    expect(parsed.rawEpisodeNumber).toBe(13);
    expect(parsed.episodeOffset).toBe(12);
  });
});
