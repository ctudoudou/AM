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

  it("treats Cantonese broadcast tags as audio profile metadata, not subtitle groups", () => {
    const parsed = parseAnimeReleaseTitle(
      "[TVB粵語][粵語+][WEB YUE] Some Anime - 03 [1080p][AVC AAC]",
    );

    expect(parsed.parsedTitle).toBe("Some Anime");
    expect(parsed.episodeNumber).toBe(3);
    expect(parsed.subtitleGroup).toBeUndefined();
    expect(parsed.sourceKind).toBe("WEB");
    expect(parsed.releaseProfile).toContain("TVB 粤语");
    expect(parsed.releaseProfile).toContain("粤语音轨");
    expect(parsed.releaseProfile).not.toContain("TVB粵語");
    expect(parsed.releaseProfile).not.toContain("WEB YUE");
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

  it("extracts real titles before complete episode range tags", () => {
    const witchWatch = parseAnimeReleaseTitle(
      "[桜都字幕组] 魔女与使魔 / Witch Watch [01-25Fin][1080P][简体内嵌]",
    );
    const agents = parseAnimeReleaseTitle(
      "[❀拨雪寻春❀] 春夏秋冬代行者 春之舞 / Shunkashuutou Daikousha - Haru no Mai / Agents of the Four Seasons [01-05][WebRip][HEVC-10bit 1080p][简繁日内封]",
    );

    expect(witchWatch.parsedTitle).toBe("魔女与使魔 / Witch Watch");
    expect(witchWatch.normalizedTitle).toBe("魔女与使魔");
    expect(witchWatch.releaseProfile).not.toContain("01-25Fin");
    expect(agents.parsedTitle).toBe(
      "春夏秋冬代行者 春之舞 / Shunkashuutou Daikousha - Haru no Mai / Agents of the Four Seasons",
    );
    expect(agents.normalizedTitle).toBe("春夏秋冬代行者 春之舞");
    expect(agents.releaseProfile).not.toContain("01-05");
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

  it("treats broadcast edition markers as release metadata, not title text", () => {
    const parsed = parseAnimeReleaseTitle(
      "[黒ネズミたち] 弱弱老师（放送版） / Yowayowa Sensei (On-air version) - 03 (ABEMA 1920x1080 AVC AAC MKV)",
    );

    expect(parsed.parsedTitle).toBe("弱弱老师 / Yowayowa Sensei");
    expect(parsed.normalizedTitle).toBe("弱弱老师");
    expect(parsed.episodeNumber).toBe(3);
    expect(parsed.sourceKind).toBe("ABEMA");
  });

  it("treats age-restricted edition markers as release metadata, not title text", () => {
    const parsed = parseAnimeReleaseTitle(
      "[黒ネズミたち] 淫獄團地 [年齡限制版] / Ingoku Danchi - 07 (Baha 1920x1080 AVC AAC MP4)",
    );

    expect(parsed.parsedTitle).toBe("淫獄團地 / Ingoku Danchi");
    expect(parsed.normalizedTitle).toBe("淫狱团地");
    expect(parsed.episodeNumber).toBe(7);
    expect(parsed.releaseProfile).not.toContain("年齡限制版");
  });

  it("treats uncut edition markers as release metadata, not title text", () => {
    const parsed = parseAnimeReleaseTitle(
      "[LoliHouse] 淫狱团地(无修版) / Ingoku Danchi - 04 [WebRip 1080p HEVC-10bit AAC][简繁内封字幕]",
    );

    expect(parsed.parsedTitle).toBe("淫狱团地 / Ingoku Danchi");
    expect(parsed.normalizedTitle).toBe("淫狱团地");
    expect(parsed.episodeNumber).toBe(4);
    expect(parsed.releaseProfile).not.toContain("无修版");
  });

  it("extracts titles before dash-prefixed EP numbers and ignores subtitle language brackets", () => {
    const parsed = parseAnimeReleaseTitle(
      "[TV版&完全无修版] 淫狱团地 - EP05 [简／繁] (1080p H.264 AAC SRTx2) {インゴクダンチ | Ingoku Danchi：Deviant's Apartment Complex}",
    );

    expect(parsed.parsedTitle).toBe("淫狱团地");
    expect(parsed.normalizedTitle).toBe("淫狱团地");
    expect(parsed.episodeNumber).toBe(5);
    expect(parsed.parsedTitle).not.toBe("简／繁");
  });

  it("skips chained release prefixes before leading titles", () => {
    const parsed = parseAnimeReleaseTitle(
      "[搬運][ANi] A Hundred Scenes of AWAJIMA / 淡島百景 - 04 [1080P][Baha][WEB-DL][AAC AVC][CHT][MP4]",
    );
    const batch = parseAnimeReleaseTitle(
      "[個人製作合集][LoliHouse] 叹气的亡灵想隐退 / Nageki no Bourei wa Intai shitai - 14-24 [WebRip 1080p HEVC-10bit AAC][简繁内封字幕]",
    );

    expect(parsed.parsedTitle).toBe("A Hundred Scenes of AWAJIMA / 淡島百景");
    expect(parsed.normalizedTitle).toBe("淡岛百景");
    expect(parsed.episodeNumber).toBe(4);
    expect(parsed.parsedTitle).not.toBe("ANi");
    expect(batch.parsedTitle).toBe("叹气的亡灵想隐退 / Nageki no Bourei wa Intai shitai");
    expect(batch.parsedTitle).not.toBe("LoliHouse");
  });

  it("parses star-delimited release titles without keeping release metadata", () => {
    const parsed = parseAnimeReleaseTitle(
      "六四位元字幕组★哪里有温柔对待阿宅的辣妹！？ Otaku ni Yasashii Gal wa Inai★04★1920x1080★AVC AAC MP4★繁体中文",
    );

    expect(parsed.parsedTitle).toBe("哪里有温柔对待阿宅的辣妹！？ Otaku ni Yasashii Gal wa Inai");
    expect(parsed.episodeNumber).toBe(4);
    expect(parsed.resolution).toBe("1080p");
    expect(parsed.parsedTitle).not.toContain("MP4");
  });

  it("drops descriptive batch ranges from bracket title aliases", () => {
    const parsed = parseAnimeReleaseTitle(
      "[SweetSub][正相反的你与我][Seihantai na Kimi to Boku][01-12 精校合集][WebRip][1080P][AVC 8bit][简日双语]（检索用：相反的你和我）",
    );

    expect(parsed.parsedTitle).toBe("正相反的你与我 / Seihantai na Kimi to Boku");
    expect(parsed.normalizedTitle).toBe("正相反的你与我");
    expect(parsed.parsedTitle).not.toContain("01-12");
  });

  it("does not parse bracketed years as episode numbers", () => {
    const parsed = parseAnimeReleaseTitle(
      "十二国记.日语.内挂英文(外挂俄语+俄文字幕).Juuni Kokuki (The Twelve Kingdoms, Двенадцать королевств) [TV 45, 2002][BDRip][MC]",
    );

    expect(parsed.episodeNumber).toBeUndefined();
    expect(parsed.parsedTitle).not.toBe("TV 45, / BDRip / MC");
    expect(parsed.parsedTitle).not.toBe("MC");
  });
});
