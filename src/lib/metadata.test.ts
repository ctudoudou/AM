import { describe, expect, it } from "vitest";
import { buildAnimeMetadataQueries } from "./metadata";

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
