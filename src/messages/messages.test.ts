import { describe, expect, it } from "vitest";
import { locales } from "@/lib/i18n";
import { getMessages } from ".";
import { en } from "./en";
import { zhHans } from "./zh-Hans";
import { zhHant } from "./zh-Hant";

describe("messages", () => {
  it("keeps all shipped dictionaries on the same key set", () => {
    const expected = Object.keys(en).sort();

    expect(Object.keys(zhHans).sort()).toEqual(expected);
    expect(Object.keys(zhHant).sort()).toEqual(expected);
    for (const locale of locales) {
      expect(Object.keys(getMessages(locale)).sort()).toEqual(expected);
    }
  });

  it("ships a real Traditional Chinese dictionary", () => {
    expect(zhHant.settings).toBe("設定");
    expect(zhHant.animeLibrary).toBe("動漫庫");
    expect(zhHant.noSubtitleTracks).toContain("還沒有字幕");
  });

  it("uses media-specific back labels on detail pages", () => {
    expect(en.backToLibrary).toBe("Back to library");
    expect(en.backToMovies).toBe("Back to movies");
    expect(en.backToTv).toBe("Back to TV");
    expect(zhHans.backToTv).toBe("返回电视剧库");
    expect(zhHant.backToTv).toBe("返回電視劇庫");
  });
});
