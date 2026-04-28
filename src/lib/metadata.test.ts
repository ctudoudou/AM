import { describe, expect, it } from "vitest";
import { buildAnimeMetadataQueries, scoreMetadataRelevance } from "./metadata";

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
