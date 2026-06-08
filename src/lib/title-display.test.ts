import { describe, expect, it } from "vitest";
import { resolveMediaDisplayTitle } from "./title-display";

const settings = {
  general: {
    defaultLocale: "zh-Hans" as const,
    subscriptionFrequencyMinutes: 30,
    animeTitleLanguageOrder: ["zh-Hant", "ja", "zh-Hans", "en", "romaji"] as const,
  },
};

describe("resolveMediaDisplayTitle", () => {
  it("uses traditional Chinese before Japanese and English by default", () => {
    const title = resolveMediaDisplayTitle(
      {
        primaryTitle: "A Hundred Scenes of Awajima",
        originalTitle: "淡島百景",
        aliases: [{ title: "A Hundred Scenes of Awajima", locale: "en" }],
      },
      settings,
    );

    expect(title.displayTitle).toBe("淡島百景");
    expect(title.matchedLocale).toBe("zh-Hant");
  });

  it("allows a single title to override the global language", () => {
    const title = resolveMediaDisplayTitle(
      {
        primaryTitle: "入间同学入魔了 第四季 / Mairimashita! Iruma-kun",
        originalTitle: "魔入りました！入間くん 第4シリーズ",
        titleDisplayMode: "JA",
      },
      settings,
    );

    expect(title.displayTitle).toBe("魔入りました！入間くん");
    expect(title.matchedLocale).toBe("ja");
  });

  it("removes explicit season qualifiers from display titles", () => {
    const title = resolveMediaDisplayTitle(
      {
        primaryTitle: "Kanojo, Okarishimasu 5th Season",
        originalTitle: "彼女、お借りします 第5期",
        aliases: [
          { title: "出租女友 第五季", locale: "zh-Hant" },
          { title: "租借女友 第五季", locale: "zh-Hant" },
          { title: "RentaGirlfriend S05", locale: "romaji" },
        ],
      },
      settings,
    );

    expect(title.displayTitle).toBe("出租女友");
    expect(title.secondaryTitles).toContain("租借女友");
    expect([title.displayTitle, ...title.secondaryTitles].join(" ")).not.toMatch(
      /第五季|第5期|5th Season|S05/i,
    );
  });

  it("uses custom display title above aliases", () => {
    const title = resolveMediaDisplayTitle(
      {
        primaryTitle: "A Hundred Scenes of Awajima",
        originalTitle: "淡島百景",
        titleDisplayMode: "CUSTOM",
        customDisplayTitle: "淡島百景 自定义",
      },
      settings,
    );

    expect(title.displayTitle).toBe("淡島百景 自定义");
    expect(title.matchedLocale).toBe("custom");
  });

  it("does not show broadcast edition markers as part of anime titles", () => {
    const title = resolveMediaDisplayTitle(
      {
        primaryTitle: "弱弱老师 放送版 / Yowayowa Sensei On-air version",
        originalTitle: "よわよわ先生",
        aliases: [
          { title: "弱弱老師 放送版", locale: "zh-Hant" },
          { title: "Yowayowa Sensei On-air version", locale: "en" },
        ],
      },
      settings,
    );

    expect(title.displayTitle).toBe("弱弱老師");
    expect(title.secondaryTitles).toContain("よわよわ先生");
    expect(title.secondaryTitles).toContain("弱弱老师");
  });

  it("does not promote episode release aliases as anime display titles", () => {
    const title = resolveMediaDisplayTitle(
      {
        primaryTitle: "Sousou no Frieren",
        originalTitle: "葬送のフリーレン",
        aliases: [
          {
            title: "Sousou no Frieren - S01E09 [❀撥雪尋春❀][1080p][HEVC]",
            locale: "zh-Hant",
          },
          { title: "[Haruhana] Sousou no Frieren - 09 [HEVC-10bit 1080p][CHT_JPN].mkv" },
        ],
      },
      settings,
    );

    expect(title.displayTitle).toBe("葬送のフリーレン");
    expect(title.secondaryTitles).toContain("Sousou no Frieren");
    expect([title.displayTitle, ...title.secondaryTitles].join(" ")).not.toMatch(
      /S01E09|1080p|HEVC|\.mkv/i,
    );
  });

  it("falls back to the real localized title when release aliases contain localized episode notes", () => {
    const title = resolveMediaDisplayTitle(
      {
        primaryTitle: "躲在超市后门抽烟的两人",
        originalTitle: "スーパーの裏でヤニ吸うふたり",
        aliases: [
          {
            title: "Behind the Supermarket, Smoking with You. - S01E01 [黒ネズミたち][1080p][AVC]",
            locale: "zh-Hant",
          },
          {
            title: "[Dynamis One] Super no Ura de Yani Suu Futari - 01 (CR 1920x1080 AVC AAC MKV) [857157AF].mkv",
          },
        ],
      },
      settings,
    );

    expect(title.displayTitle).toBe("躲在超市後門抽菸的兩人");
    expect([title.displayTitle, ...title.secondaryTitles].join(" ")).not.toMatch(
      /S01E01|1080p|AVC|Dynamis|\.mkv/i,
    );
  });
});
