import { describe, expect, it } from "vitest";
import { buildWantedEpisodeCoverage } from "./wanted-episodes";

const baseMedia = {
  id: "media-1",
  type: "ANIME",
  primaryTitle: "淡島百景",
  originalTitle: "淡島百景",
  titleDisplayMode: "GLOBAL",
  customDisplayTitle: null,
  year: null,
  synopsis: null,
  posterUrl: null,
  backdropUrl: null,
  rating: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  aliases: [{ title: "Awajima Hyakkei" }],
};

describe("buildWantedEpisodeCoverage", () => {
  it("detects an in-between missing episode", () => {
    const coverage = buildWantedEpisodeCoverage(
      {
        ...baseMedia,
        seasons: [
          {
            number: 1,
            episodes: [
              { id: "ep1", number: 1, title: "EP01", files: [{ id: "file1" }] },
              { id: "ep3", number: 3, title: "EP03", files: [{ id: "file3" }] },
            ],
          },
        ],
      },
      [],
      [],
    );

    expect(coverage.episodes).toMatchObject([
      { episodeNumber: 1, status: "AVAILABLE" },
      { episodeNumber: 2, status: "MISSING" },
      { episodeNumber: 3, status: "AVAILABLE" },
    ]);
    expect(coverage.missingCount).toBe(1);
  });

  it("marks a missing episode as candidate found", () => {
    const coverage = buildWantedEpisodeCoverage(
      {
        ...baseMedia,
        seasons: [
          {
            number: 1,
            episodes: [
              { id: "ep1", number: 1, title: "EP01", files: [{ id: "file1" }] },
            ],
          },
        ],
      },
      [
        {
          id: "candidate-2",
          groupId: "group-1",
          rssItemId: "rss-1",
          mediaType: "ANIME",
          rawTitle: "淡島百景 - 02",
          parsedTitle: "淡島百景",
          normalizedTitle: "淡島百景",
          subtitleGroup: null,
          episodeNumber: 2,
          season: 1,
          resolution: null,
          codec: null,
          audio: null,
          subtitleLanguage: null,
          releaseProfile: null,
          sourceKind: null,
          variantKey: null,
          releaseTags: null,
          magnetUrl: "magnet:?xt=urn:btih:test",
          torrentUrl: null,
          torrentFilePath: null,
          sourceUrl: null,
          confidence: 0.9,
          status: "READY",
          createdAt: new Date(),
          updatedAt: new Date(),
          downloads: [],
          organizerPlans: [],
          group: { displayTitle: "淡島百景", normalizedTitle: "淡島百景", aliases: [] },
        },
      ],
      [],
    );

    expect(coverage.episodes).toContainEqual(
      expect.objectContaining({
        episodeNumber: 2,
        status: "CANDIDATE_FOUND",
        candidateId: "candidate-2",
      }),
    );
  });

  it("does not treat empty organizer plans as actionable waiting work", () => {
    const coverage = buildWantedEpisodeCoverage(
      {
        ...baseMedia,
        seasons: [{ number: 1, episodes: [] }],
      },
      [
        {
          id: "candidate-2",
          groupId: "group-1",
          rssItemId: "rss-1",
          mediaType: "ANIME",
          rawTitle: "淡島百景 - 02",
          parsedTitle: "淡島百景",
          normalizedTitle: "淡島百景",
          subtitleGroup: null,
          episodeNumber: 2,
          season: 1,
          resolution: null,
          codec: null,
          audio: null,
          subtitleLanguage: null,
          releaseProfile: null,
          sourceKind: null,
          variantKey: null,
          releaseTags: null,
          magnetUrl: "magnet:?xt=urn:btih:test",
          torrentUrl: null,
          torrentFilePath: null,
          sourceUrl: null,
          confidence: 0.9,
          status: "DOWNLOADED",
          createdAt: new Date(),
          updatedAt: new Date(),
          downloads: [{ status: "COMPLETED" }],
          organizerPlans: [{ status: "NEEDS_REVIEW", items: [] }],
          group: { displayTitle: "淡島百景", normalizedTitle: "淡島百景", aliases: [] },
        },
      ],
      [],
    );

    expect(coverage.episodes).toContainEqual(
      expect.objectContaining({
        episodeNumber: 2,
        status: "DOWNLOADED",
        reason: "Download completed but organizer plan has no files; run organizer scan",
      }),
    );
  });

  it("marks downloaded episodes as waiting for organizer only when the plan has files", () => {
    const coverage = buildWantedEpisodeCoverage(
      {
        ...baseMedia,
        seasons: [{ number: 1, episodes: [] }],
      },
      [
        {
          id: "candidate-2",
          groupId: "group-1",
          rssItemId: "rss-1",
          mediaType: "ANIME",
          rawTitle: "淡島百景 - 02",
          parsedTitle: "淡島百景",
          normalizedTitle: "淡島百景",
          subtitleGroup: null,
          episodeNumber: 2,
          season: 1,
          resolution: null,
          codec: null,
          audio: null,
          subtitleLanguage: null,
          releaseProfile: null,
          sourceKind: null,
          variantKey: null,
          releaseTags: null,
          magnetUrl: "magnet:?xt=urn:btih:test",
          torrentUrl: null,
          torrentFilePath: null,
          sourceUrl: null,
          confidence: 0.9,
          status: "DOWNLOADED",
          createdAt: new Date(),
          updatedAt: new Date(),
          downloads: [{ status: "COMPLETED" }],
          organizerPlans: [{ status: "NEEDS_REVIEW", items: [{ id: "item-1" }] }],
          group: { displayTitle: "淡島百景", normalizedTitle: "淡島百景", aliases: [] },
        },
      ],
      [],
    );

    expect(coverage.episodes).toContainEqual(
      expect.objectContaining({
        episodeNumber: 2,
        status: "DOWNLOADED",
        reason: "Downloaded and waiting for organizer",
      }),
    );
  });
});
