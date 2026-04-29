import { describe, expect, it } from "vitest";
import { buildWantedEpisodeSearchQueries, parseWantedSearchFeed } from "./wanted-rss-search";

const wanted = {
  id: "wanted-1",
  mediaTitleId: "media-1",
  seasonNumber: 1,
  episodeNumber: 3,
  status: "MISSING" as const,
  matchedCandidateId: null,
  ignored: false,
  reason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  mediaTitle: {
    id: "media-1",
    type: "ANIME" as const,
    primaryTitle: "入间同学入魔了",
    originalTitle: "魔入りました！入間くん",
    titleDisplayMode: "GLOBAL" as const,
    customDisplayTitle: null,
    year: null,
    synopsis: null,
    posterUrl: null,
    backdropUrl: null,
    rating: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    aliases: [
      {
        id: "alias-1",
        mediaId: "media-1",
        title: "Welcome to Demon School! Iruma-kun",
        locale: "en",
        createdAt: new Date(),
      },
    ],
  },
};

describe("wanted RSS search", () => {
  it("builds episode-aware search queries from title aliases", () => {
    expect(buildWantedEpisodeSearchQueries(wanted)).toEqual(
      expect.arrayContaining([
        "入间同学入魔了 03",
        "入间同学入魔了 3",
        "魔入りました！入間くん 03",
        "Welcome to Demon School! Iruma-kun 03",
      ]),
    );
  });

  it("parses RSS results with magnet and torrent links", () => {
    const results = parseWantedSearchFeed(
      `<?xml version="1.0" encoding="UTF-8" ?>
      <rss version="2.0">
        <channel>
          <item>
            <title>[Group] 入间同学入魔了 S04 - 03 [1080p]</title>
            <link>https://example.test/download/iruma-03.torrent</link>
            <guid>magnet:?xt=urn:btih:test</guid>
            <pubDate>Wed, 29 Apr 2026 10:00:00 GMT</pubDate>
            <nyaa:seeders>12</nyaa:seeders>
            <nyaa:size>1.3 GiB</nyaa:size>
          </item>
        </channel>
      </rss>`,
      { provider: "test", sourceId: null, sourceName: "Test RSS" },
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      sourceName: "Test RSS",
      title: "[Group] 入间同学入魔了 S04 - 03 [1080p]",
      link: "https://example.test/download/iruma-03.torrent",
      magnetUrl: "magnet:?xt=urn:btih:test",
      torrentUrl: "https://example.test/download/iruma-03.torrent",
      seeders: 12,
      size: "1.3 GiB",
    });
  });
});
