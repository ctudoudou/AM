import { describe, expect, it } from "vitest";
import {
  buildAnimeMetadataQueries,
  collectAnimeMetadataQueryTexts,
  scoreMetadataRelevance,
} from "./metadata";

describe("buildAnimeMetadataQueries", () => {
  it("creates provider-friendly queries from bilingual seasonal titles", () => {
    const queries = buildAnimeMetadataQueries([
      "入间同学入魔了 第四季 / Mairimashita! Iruma-kun",
    ]);

    expect(queries).toContain("入间同学入魔了 第四季 / Mairimashita! Iruma-kun");
    expect(queries).toContain("入间同学入魔了");
    expect(queries).toContain("Mairimashita! Iruma-kun");
  });

  it("adds English season variants when a season is present", () => {
    const queries = buildAnimeMetadataQueries(["Mairimashita! Iruma-kun 第四季"]);

    expect(queries).toContain("Mairimashita! Iruma-kun");
    expect(queries).toContain("Mairimashita! Iruma-kun 4th Season");
    expect(queries).toContain("Mairimashita! Iruma-kun Season 4");
  });

  it("prioritizes clean aliases before long release-derived episode titles", () => {
    const queries = buildAnimeMetadataQueries([
      "我和班上第二可爱的女生成为朋友",
      "我和班上第二可愛的女生成為朋友",
      "Kuranika",
      "[Dynamis One] Kuranika - 04 (CR 1920x1080 AVC AAC MKV) [E1E81F68].mkv",
      "我和班上第二可爱的女生成为朋友 - S01E04 - 我和班上第二可爱的女生成为朋友 Kuranika [黒ネズミたち][1080p][AVC]",
      "和班上第二可爱的女孩子成了朋友",
      "クラスで２番目に可愛い女の子と友だちになった",
      "[LoliHouse] Class de 2-banme ni Kawaii Onnanoko to Tomodachi ni Natta - 01 [WebRip 1080p HEVC-10bit AAC SRTx2].mkv",
    ]);

    expect(queries.slice(0, 10)).toContain("クラスで２番目に可愛い女の子と友だちになった");
    expect(queries.slice(0, 10)).toContain("Class de 2-banme ni Kawaii Onnanoko to Tomodachi ni Natta");
  });
});

describe("collectAnimeMetadataQueryTexts", () => {
  it("uses episode titles and file names as recovery queries", () => {
    const queries = buildAnimeMetadataQueries(
      collectAnimeMetadataQueryTexts({
        primaryTitle: "A Hundred Scenes of Awajima",
        originalTitle: null,
        aliases: [{ title: "A Hundred Scenes of Awajima" }],
        seasons: [
          {
            episodes: [
              {
                title: "淡岛百景 / Awajima Hyakkei",
                files: [
                  {
                    originalName: "[ANi] Awajima Hyakkei - 01.mkv",
                    absolutePath: "/data/library/anime/A Hundred Scenes of Awajima/Season 01/Awajima Hyakkei - 01.mkv",
                  },
                ],
              },
            ],
          },
        ],
      }),
    );

    expect(queries).toContain("淡岛百景");
    expect(queries).toContain("Awajima Hyakkei");
  });
});

describe("scoreMetadataRelevance", () => {
  it("rejects unrelated high-popularity provider results", () => {
    const score = scoreMetadataRelevance(
      "最强的职业不是勇者也不是贤者好像是鉴定士 暂 的样子 / Kanteishikari",
      {
        provider: "jikan",
        externalId: "40784",
        title: "Scissor Seven: The Strongest Hairstylist",
        originalTitle: "伍六七之最强发型师",
        score: 0.9,
        raw: {
          title_english: "Scissor Seven: The Strongest Hairstylist",
          title_japanese: "伍六七之最强发型师",
          title_synonyms: ["Scissor Seven Season 2", "刺客伍六七 第二季"],
        },
      },
    );

    expect(score).toBeLessThan(0.48);
  });

  it("accepts compressed romanized aliases from provider titles", () => {
    const score = scoreMetadataRelevance("Kanteishikari", {
      provider: "jikan",
      externalId: "example",
      title: "Kanteishi Kari",
      score: 0.7,
      raw: {
        titles: [{ title: "Kanteishi Kari" }],
      },
    });

    expect(score).toBe(1);
  });
});
