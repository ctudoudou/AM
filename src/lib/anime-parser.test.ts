import { describe, expect, it } from "vitest";
import { normalizeTitleAliases, parseAnimeReleaseTitle } from "./anime-parser";

describe("parseAnimeReleaseTitle", () => {
  it("parses subtitle group, episode, resolution, and codec", () => {
    const parsed = parseAnimeReleaseTitle(
      "[Lilith-Raws] Sousou no Frieren - 12 [Baha][WEB-DL][1080p][AVC AAC][CHT]",
    );

    expect(parsed.subtitleGroup).toBe("Lilith-Raws");
    expect(parsed.episodeNumber).toBe(12);
    expect(parsed.resolution).toBe("1080p");
    expect(parsed.codec).toBe("AVC");
    expect(parsed.audio).toBe("AAC");
    expect(parsed.subtitleLanguage).toBe("CHT");
    expect(parsed.sourceKind).toBe("Baha");
    expect(parsed.variantKey).toContain("lilith raws");
    expect(parsed.normalizedTitle).toContain("sousou no frieren");
  });

  it("does not keep video file extensions in parsed titles", () => {
    const parsed = parseAnimeReleaseTitle(
      "[Ends with Love] Aishiteru Game wo Owarasetai [03][WebRip 1080P AVC-8bit AAC][CHT].mp4",
    );

    expect(parsed.parsedTitle).toBe("Aishiteru Game wo Owarasetai");
    expect(parsed.normalizedTitle).toBe("aishiteru game wo owarasetai");
    expect(parsed.episodeNumber).toBe(3);
    expect(parsed.resolution).toBe("1080P");
    expect(parsed.codec).toBe("AVC");
    expect(parsed.subtitleLanguage).toBe("CHT");
  });

  it("parses SxxExx style releases", () => {
    const parsed = parseAnimeReleaseTitle(
      "[Group] Cyber City S02E03 2160p HEVC FLAC",
    );

    expect(parsed.season).toBe(2);
    expect(parsed.episodeNumber).toBe(3);
    expect(parsed.resolution).toBe("2160p");
    expect(parsed.codec).toBe("HEVC");
  });

  it("keeps bilingual titles stable and extracts detailed subtitle profiles", () => {
    const parsed = parseAnimeReleaseTitle(
      "[喵萌奶茶屋&LoliHouse] Awajima Hyakkei / 淡岛百景 - 01 [WebRip 1080p HEVC-10bit AAC][简繁日内封字幕]",
    );

    expect(parsed.parsedTitle).toBe("Awajima Hyakkei / 淡岛百景");
    expect(parsed.episodeNumber).toBe(1);
    expect(parsed.sourceKind).toBe("WEBRip");
    expect(parsed.codec).toBe("HEVC");
    expect(parsed.audio).toBe("AAC");
    expect(parsed.subtitleLanguage).toBe("CHS+CHT+JPN");
    expect(parsed.releaseProfile).toContain("简繁日内封");
    expect(parsed.releaseProfile).not.toContain("01");
    expect(parsed.variantKey).toContain("chs+cht+jpn");
  });

  it("does not leave empty episode brackets in parsed titles", () => {
    const parsed = parseAnimeReleaseTitle(
      "[桜都字幕组] 入间同学入魔了 第四季 / Mairimashita! Iruma-kun (2026) [01][1080P][简繁内封]",
    );

    expect(parsed.parsedTitle).toBe("入间同学入魔了 第四季 / Mairimashita! Iruma-kun");
    expect(parsed.normalizedTitle).not.toContain("[]");
  });

  it("normalizes multilingual season title variants into one anime key", () => {
    const titles = [
      "[桜都字幕组] 入间同学入魔了 第四季 / Mairimashita! Iruma-kun (2026) [03][1080P][简繁内封]",
      "[ANi]  入間同學入魔了！第四季 - 03 [1080P][Baha][WEB-DL][AAC AVC][CHT][MP4]",
      "[黒ネズミたち] 入间同学入魔了！第四季 / Mairimashita! Iruma-kun 4th Season - 04 (CR 1920x1080 AVC AAC MKV)",
      "[LoliHouse] 入间同学入魔了！S4 / Mairimashita! Iruma-kun S4 - 04 [WebRip 1080p HEVC-10bit AAC][简繁内封字幕]",
    ];

    const parsed = titles.map((title) => parseAnimeReleaseTitle(title));

    expect(new Set(parsed.map((item) => item.normalizedTitle))).toEqual(
      new Set(["入间同学入魔了"]),
    );
    expect(new Set(parsed.map((item) => item.season))).toEqual(new Set([4]));
  });

  it("extracts real titles from month-new-anime RSS banners", () => {
    const parsed = parseAnimeReleaseTitle(
      "【喵萌奶茶屋】★04月新番★[杖与剑的魔剑谭 / Tsue to Tsurugi no Wistoria][15][1080p][简日双语]",
    );

    expect(parsed.parsedTitle).toBe("杖与剑的魔剑谭 / Tsue to Tsurugi no Wistoria");
    expect(parsed.normalizedTitle).toBe("杖与剑的魔剑谭");
    expect(parsed.episodeNumber).toBe(15);
    expect(parsed.releaseProfile).not.toContain("04月新番");
  });

  it("keeps adjacent bracket title aliases while dropping release banners", () => {
    const parsed = parseAnimeReleaseTitle(
      "[爱恋字幕社][4月新番][春夏秋冬代行者][Shunkashuutou Daikousha - Haru no Mai][04][1080p][MP4][GB][简中]",
    );

    expect(parsed.parsedTitle).toBe("春夏秋冬代行者 / Shunkashuutou Daikousha - Haru no Mai");
    expect(parsed.normalizedTitle).toBe("春夏秋冬代行者");
    expect(parsed.episodeNumber).toBe(4);
    expect(parsed.releaseProfile).not.toContain("4月新番");
  });

  it("normalizes alternate Chinese aliases for the same anime", () => {
    const titles = [
      "[黒ネズミたち] 上伊那牡丹，酒醉身姿似百合花般 / Kamiina Botan, Yoeru Sugata wa Yuri no Hana - 03 (B-Global 1920x1080 HEVC AAC MKV)",
      "[Skymoon-Raws] 上伊那牡丹，醉姿如百合 / Kamiina Botan, Yoeru Sugata wa Yuri no Hana - 03 [ViuTV][WEB-DL][CHT][1080p][AVC AAC]",
      "[千夏字幕组][上伊那牡丹，醉姿如百合_Kamiina Botan, Yoeru Sugata wa Yuri no Hana][第03话][1080p_AVC][繁体]",
    ];

    const parsed = titles.map((title) => parseAnimeReleaseTitle(title));

    expect(new Set(parsed.map((item) => item.normalizedTitle))).toEqual(
      new Set(["上伊那牡丹 酒醉身姿似百合花般", "上伊那牡丹 醉姿如百合"]),
    );
    expect(
      parsed.every((item) =>
        normalizeTitleAliases(item.parsedTitle).includes("kamiina botan yoeru sugata wa yuri no hana"),
      ),
    ).toBe(true);
    expect(parsed[1].parsedTitle).toBe("上伊那牡丹，醉姿如百合 / Kamiina Botan, Yoeru Sugata wa Yuri no Hana");
    expect(parsed[2].parsedTitle).toBe("上伊那牡丹，醉姿如百合 / Kamiina Botan, Yoeru Sugata wa Yuri no Hana");
    expect(parsed[2].releaseProfile).not.toContain("Kamiina Botan");
  });

  it("separates source variants while preserving tentative title words", () => {
    const abema = parseAnimeReleaseTitle(
      "[黒ネズミたち] 最强的职业不是勇者也不是贤者好像是鉴定士（暂）的样子 / Kanteishikari - 04 (ABEMA 1920x1080 AVC AAC MKV)",
    );
    const crunchyroll = parseAnimeReleaseTitle(
      "[黒ネズミたち] 最强的职业不是勇者也不是贤者好像是鉴定士（暂）的样子 / Kanteishikari - 05 (CR 1920x1080 AVC AAC MKV)",
    );
    const loliHouse = parseAnimeReleaseTitle(
      "[LoliHouse] 最强的职业不是勇者也不是贤者好像是鉴定士(暂定)的样子？ / Kanteishi (Kari) - 05 [WebRip 1080p HEVC-10bit AAC][无中字]",
    );

    expect(abema.normalizedTitle).toBe("最强的职业不是勇者也不是贤者好像是鉴定士 暂 的样子");
    expect(crunchyroll.normalizedTitle).toBe("最强的职业不是勇者也不是贤者好像是鉴定士 暂 的样子");
    expect(loliHouse.normalizedTitle).toBe("最强的职业不是勇者也不是贤者好像是鉴定士 暂定 的样子");
    expect(normalizeTitleAliases(abema.parsedTitle)).toContain("kanteishikari");
    expect(normalizeTitleAliases(loliHouse.parsedTitle)).toContain("kanteishikari");
    expect(abema.resolution).toBe("1080p");
    expect(abema.sourceKind).toBe("ABEMA");
    expect(crunchyroll.sourceKind).toBe("CR");
    expect(abema.variantKey).toContain("abema");
    expect(crunchyroll.variantKey).toContain("cr");
    expect(abema.variantKey).not.toBe(crunchyroll.variantKey);
  });
});
