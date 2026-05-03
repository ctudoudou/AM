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

  it("prioritizes clean title aliases for broadcast-edition releases", () => {
    expect(
      buildWantedEpisodeSearchQueries({
        ...wanted,
        episodeNumber: 1,
        mediaTitle: {
          ...wanted.mediaTitle,
          primaryTitle: "弱弱老师 放送版 / Yowayowa Sensei On-air version",
          originalTitle: "よわよわ先生",
          aliases: [
            {
              id: "alias-yowa-1",
              mediaId: "media-1",
              title: "弱弱老師",
              locale: "zh-Hant",
              createdAt: new Date(),
            },
            {
              id: "alias-yowa-2",
              mediaId: "media-1",
              title: "[Dynamis One] Yowayowa Sensei (On-air version) - 03 (ABEMA 1920x1080 AVC AAC MKV).mkv",
              locale: "en",
              createdAt: new Date(),
            },
          ],
        },
      }).slice(0, 6),
    ).toEqual([
      "弱弱老师 01",
      "弱弱老师 1",
      "Yowayowa Sensei 01",
      "Yowayowa Sensei 1",
      "よわよわ先生 01",
      "よわよわ先生 1",
    ]);
  });

  it("keeps enough title aliases for older episode backfill searches", () => {
    const queries = buildWantedEpisodeSearchQueries({
      ...wanted,
      episodeNumber: 1,
      mediaTitle: {
        ...wanted.mediaTitle,
        primaryTitle: "女骑士成为蛮族新娘",
        originalTitle: "姫騎士は蛮族の嫁",
        aliases: [
          {
            id: "alias-hime-1",
            mediaId: "media-1",
            title: "Hime Kishi wa Barbaroi no Yome",
            locale: "romaji",
            createdAt: new Date(),
          },
          {
            id: "alias-hime-2",
            mediaId: "media-1",
            title: "Himekishi wa Barbaroi no Yome",
            locale: "romaji",
            createdAt: new Date(),
          },
        ],
      },
    });

    expect(queries).toContain("女骑士成为蛮族新娘 01");
    expect(queries).toContain("姫騎士は蛮族の嫁 01");
    expect(queries).toContain("Himekishi wa Barbaroi no Yome 01");
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
