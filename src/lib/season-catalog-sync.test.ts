import { describe, expect, it } from "vitest";
import { buildCatalogEntriesFromTvdbEpisodes } from "./season-catalog-sync";

describe("buildCatalogEntriesFromTvdbEpisodes", () => {
  it("builds episode counts and absolute ranges from official-order episodes", () => {
    const entries = buildCatalogEntriesFromTvdbEpisodes("424536", [
      { seasonNumber: 1, number: 1, absoluteNumber: 1 },
      { seasonNumber: 1, number: 2, absoluteNumber: 2 },
      { seasonNumber: 1, number: 28, absoluteNumber: 28 },
      { seasonNumber: 2, number: 1, absoluteNumber: 29 },
      { seasonNumber: 2, number: 10, absoluteNumber: 38 },
    ]);

    expect(entries).toEqual([
      {
        seasonNumber: 1,
        episodeCount: 3,
        absoluteStart: 1,
        absoluteEnd: 28,
        provider: "tvdb",
        sourceUrl: "https://thetvdb.com/series/424536/seasons/official/1",
        confidence: 0.9,
      },
      {
        seasonNumber: 2,
        episodeCount: 2,
        absoluteStart: 29,
        absoluteEnd: 38,
        provider: "tvdb",
        sourceUrl: "https://thetvdb.com/series/424536/seasons/official/2",
        confidence: 0.9,
      },
    ]);
  });

  it("keeps catalog usable when absolute numbering is absent", () => {
    const entries = buildCatalogEntriesFromTvdbEpisodes("series", [
      { seasonNumber: 1, number: 1 },
      { seasonNumber: 1, number: 2 },
    ]);

    expect(entries[0]).toMatchObject({
      seasonNumber: 1,
      episodeCount: 2,
      absoluteStart: null,
      absoluteEnd: null,
    });
  });
});
