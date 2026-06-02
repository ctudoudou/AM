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

  it("detects TV in-between missing episodes without anime-only assumptions", () => {
    const coverage = buildWantedEpisodeCoverage(
      {
        ...baseMedia,
        type: "TV",
        primaryTitle: "Slow Horses",
        originalTitle: "Slow Horses",
        aliases: [{ title: "Slow Horses" }],
        seasons: [
          {
            number: 2,
            episodes: [
              { id: "tv-ep1", number: 1, title: "S02E01", files: [{ id: "file1" }] },
              { id: "tv-ep3", number: 3, title: "S02E03", files: [{ id: "file3" }] },
            ],
          },
        ],
      },
      [],
      [],
    );

    expect(coverage.episodes).toMatchObject([
      { seasonNumber: 2, episodeNumber: 1, status: "AVAILABLE" },
      { seasonNumber: 2, episodeNumber: 2, status: "MISSING" },
      { seasonNumber: 2, episodeNumber: 3, status: "AVAILABLE" },
    ]);
  });

  it("uses complete batch ranges to infer missing tail episodes", () => {
    const coverage = buildWantedEpisodeCoverage(
      {
        ...baseMedia,
        seasons: [
          {
            number: 1,
            episodes: [{ id: "ep5", number: 5, title: "EP05", files: [{ id: "file5" }] }],
          },
        ],
      },
      [
        {
          id: "candidate-batch",
          groupId: "group-1",
          rssItemId: "rss-batch",
          mediaType: "ANIME",
          rawTitle: "[Group] 淡島百景 / Awajima Hyakkei [01-08 Fin][1080P]",
          parsedTitle: "淡島百景 / Awajima Hyakkei",
          normalizedTitle: "淡島百景",
          subtitleGroup: null,
          episodeNumber: null,
          season: 1,
          resolution: "1080P",
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
          group: { displayTitle: "淡島百景", normalizedTitle: "淡島百景", aliases: ["Awajima Hyakkei"] },
        },
      ],
      [],
    );

    expect(coverage.episodes.map((episode) => episode.episodeNumber)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(coverage.episodes.find((episode) => episode.episodeNumber === 5)?.status).toBe("AVAILABLE");
    expect(coverage.missingCount).toBe(7);
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

  it("keeps ignored episodes out of the actionable missing count", () => {
    const coverage = buildWantedEpisodeCoverage(
      {
        ...baseMedia,
        seasons: [
          {
            number: 1,
            episodes: [{ id: "ep1", number: 1, title: "EP01", files: [{ id: "file1" }] }],
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
      [
        {
          id: "wanted-2",
          seasonNumber: 1,
          episodeNumber: 2,
          status: "IGNORED",
          ignored: true,
          matchedCandidateId: "candidate-2",
          reason: "Ignored by user",
        },
      ],
    );

    expect(coverage.episodes).toContainEqual(
      expect.objectContaining({
        episodeNumber: 2,
        status: "IGNORED",
        wantedId: "wanted-2",
        candidateId: "candidate-2",
      }),
    );
    expect(coverage.missingCount).toBe(0);
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

  it("does not let base-season cumulative candidates pollute a later-season title", () => {
    const coverage = buildWantedEpisodeCoverage(
      {
        ...baseMedia,
        primaryTitle: "Kanojo, Okarishimasu 5th Season",
        originalTitle: "彼女、お借りします 第5期",
        aliases: [{ title: "出租女友 第五季" }, { title: "出租女友" }],
        seasons: [
          {
            number: 5,
            episodes: [
              { id: "s5e3", number: 3, title: "EP03", files: [{ id: "file3" }] },
              { id: "s5e4", number: 4, title: "EP04", files: [{ id: "file4" }] },
            ],
          },
        ],
      },
      [
        wantedCandidate({ id: "s5e5", rawTitle: "出租女友 第五季 - 05", season: 5, episodeNumber: 5 }),
        wantedCandidate({ id: "abs52", rawTitle: "出租女友 第五季 - 52", season: 5, episodeNumber: 52 }),
        wantedCandidate({ id: "base49", rawTitle: "租借女友 - 49", season: 1, episodeNumber: 49 }),
      ],
      [
        {
          id: "stale-52",
          seasonNumber: 5,
          episodeNumber: 52,
          status: "MISSING",
          ignored: false,
          matchedCandidateId: null,
          reason: "stale",
        },
      ],
    );

    expect(coverage.seasons).toEqual([5]);
    expect(coverage.episodes.map((episode) => episode.episodeNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(coverage.episodes.find((episode) => episode.episodeNumber === 5)).toMatchObject({
      status: "CANDIDATE_FOUND",
      candidateId: "s5e5",
    });
    expect(coverage.episodes.some((episode) => episode.episodeNumber === 52)).toBe(false);
  });

  it("does not let unqualified absolute-number candidates expand season one", () => {
    const coverage = buildWantedEpisodeCoverage(
      {
        ...baseMedia,
        primaryTitle: "葬送的芙莉蓮",
        originalTitle: "葬送のフリーレン",
        aliases: [{ title: "葬送的芙莉莲" }, { title: "Sousou no Frieren" }],
        seasons: [],
      },
      [
        wantedCandidate({
          id: "frieren-s1-38",
          rawTitle: "[北宇治字幕组] 葬送的芙莉莲 / Sousou no Frieren [38][WebRip][HEVC_AAC][简繁日内封]",
          season: null,
          episodeNumber: 38,
        }),
        wantedCandidate({
          id: "frieren-s2-8",
          rawTitle:
            "[jibaketa合成][代理商粵語]葬送的芙莉蓮 第二季 / Sousou no Frieren 2nd Season - 08 [WEB 1920x1080 AVC AAC]",
          season: 2,
          episodeNumber: 8,
        }),
      ],
      [],
    );

    expect(coverage.seasons).toEqual([2]);
    expect(coverage.episodes.some((episode) => episode.seasonNumber === 1)).toBe(false);
    expect(coverage.episodes).toContainEqual(
      expect.objectContaining({
        seasonNumber: 2,
        episodeNumber: 8,
        status: "CANDIDATE_FOUND",
        candidateId: "frieren-s2-8",
      }),
    );
  });
});

function wantedCandidate(input: {
  id: string;
  rawTitle: string;
  season: number | null;
  episodeNumber: number;
}) {
  return {
    id: input.id,
    groupId: "group-1",
    rssItemId: "rss-1",
    mediaType: "ANIME" as const,
    rawTitle: input.rawTitle,
    parsedTitle: input.rawTitle.replace(/\s+-\s+\d+$/, ""),
    normalizedTitle: "出租女友",
    subtitleGroup: null,
    episodeNumber: input.episodeNumber,
    season: input.season,
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
    status: "READY" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    downloads: [],
    organizerPlans: [],
    group: { displayTitle: "出租女友 第五季", normalizedTitle: "出租女友", aliases: [] },
  };
}
