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

    expect(title.displayTitle).toBe("魔入りました！入間くん 第4シリーズ");
    expect(title.matchedLocale).toBe("ja");
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
});
