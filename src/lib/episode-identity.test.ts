import { describe, expect, it } from "vitest";
import { analyzeEpisodeIdentity } from "@/lib/episode-identity";

describe("analyzeEpisodeIdentity", () => {
  it("allows safe season-relative single episode matches", () => {
    const identity = analyzeEpisodeIdentity({
      rawTitle: "[SubsPlease] Example Anime S02E03 [1080p].mkv",
      targetSeason: 2,
      targetEpisode: 3,
    });

    expect(identity).toMatchObject({
      rawSeason: 2,
      rawEpisode: 3,
      numberingScheme: "season_relative",
      requiresReview: false,
      safeForAutoDownload: true,
    });
  });

  it("blocks explicit wrong seasons", () => {
    const identity = analyzeEpisodeIdentity({
      rawTitle: "[SubsPlease] Example Anime S01E03 [1080p].mkv",
      targetSeason: 2,
      targetEpisode: 3,
    });

    expect(identity.safeForAutoDownload).toBe(false);
    expect(identity.requiresReview).toBe(true);
    expect(identity.evidence.join(" ")).toContain("season conflict");
  });

  it("blocks cumulative episode numbers even when an offset can be inferred", () => {
    const identity = analyzeEpisodeIdentity({
      rawTitle: "[Group] Example Anime S05E52 [1080p].mkv",
      targetSeason: 5,
      targetEpisode: 4,
      siblingCandidates: [
        { rawTitle: "Example Anime S05E03", season: 5, episodeNumber: 3 },
        { rawTitle: "Example Anime S05E04", season: 5, episodeNumber: 4 },
        { rawTitle: "Example Anime S05E51", season: 5, episodeNumber: 51 },
        { rawTitle: "Example Anime S05E52", season: 5, episodeNumber: 52 },
      ],
    });

    expect(identity.normalizedEpisode).toBe(4);
    expect(identity.numberingScheme).toBe("absolute_series");
    expect(identity.safeForAutoDownload).toBe(false);
    expect(identity.requiresReview).toBe(true);
  });

  it("treats batch releases as review-only", () => {
    const identity = analyzeEpisodeIdentity({
      rawTitle: "[Group] Example Anime [01-12][1080p].mkv",
      targetSeason: 1,
      targetEpisode: 3,
    });

    expect(identity.numberingScheme).toBe("batch_range");
    expect(identity.safeForAutoDownload).toBe(false);
  });

  it("treats cour and part releases as review-only", () => {
    expect(
      analyzeEpisodeIdentity({
        rawTitle: "[Group] Example Anime 第2クール - 13 [1080p].mkv",
        targetSeason: 1,
        targetEpisode: 1,
      }).safeForAutoDownload,
    ).toBe(false);
    expect(
      analyzeEpisodeIdentity({
        rawTitle: "[Group] Example Anime Part 3 - 30 [1080p].mkv",
        targetSeason: 1,
        targetEpisode: 6,
      }).safeForAutoDownload,
    ).toBe(false);
  });
});
