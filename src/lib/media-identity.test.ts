import { describe, expect, it } from "vitest";
import {
  candidateGroupIdentityInput,
  createMediaIdentity,
  createMediaIdentityKeys,
  mediaIdentitiesShareStrongKey,
  mediaIdentitiesOverlap,
  prepareSubscriptionCoverage,
  preparedSubscriptionCoversCandidateGroup,
  subscriptionCoversCandidateGroup,
} from "./media-identity";

describe("media identity", () => {
  it("matches Grand Blue season variants across Chinese and English release names", () => {
    expect(
      mediaIdentitiesOverlap(
        {
          mediaType: "ANIME",
          title: "碧蓝之海3 Grand Blue Dreaming! S3 GB CN",
          season: 3,
        },
        {
          mediaType: "ANIME",
          displayTitle: "GRAND BLUE 碧藍之海 / Grand Blue Season 3",
          normalizedTitle: "grand blue 碧蓝之海",
          season: 3,
        },
      ),
    ).toBe(true);
  });

  it("keeps different explicit seasons apart", () => {
    expect(
      mediaIdentitiesOverlap(
        { mediaType: "ANIME", title: "Re:从零开始的异世界生活 第4季", season: 4 },
        { mediaType: "ANIME", displayTitle: "Re：从零开始的异世界生活", season: 1 },
      ),
    ).toBe(false);
  });

  it("matches multilingual aliases split across separate candidate groups", () => {
    const chinese = createMediaIdentityKeys({
      mediaType: "ANIME",
      displayTitle: "无职英雄：技能什么的毫无用处",
      season: 1,
    });
    const bilingual = createMediaIdentityKeys({
      mediaType: "ANIME",
      displayTitle: "无职英雄：技能什么的毫无用处/Mushoku no Eiyuu: Betsu ni Skill Nanka Iranakatta n da ga S01 | 01-12",
      normalizedTitle: "无职英雄 技能什么的毫无用处/mushoku no eiyuu betsu ni skill nanka iranakatta n da ga",
      season: 1,
    });

    expect(chinese).toContain("无职英雄 技能什么的毫无用处");
    expect(bilingual).toContain("无职英雄 技能什么的毫无用处");
  });

  it("matches live romanized titles that differ by apostrophes and word hyphens", () => {
    const localizedGroup = {
      mediaType: "ANIME",
      displayTitle: "出发吧怪奇组 / レッツゴー怪奇组 / Lets Go Kaikigumi",
      normalizedTitle: "出发吧怪奇组",
      aliases: ["出发吧怪奇组 / レッツゴー怪奇组 / Lets Go Kaikigumi"],
      season: 1,
    };
    const romanizedGroup = {
      mediaType: "ANIME",
      displayTitle: "Let's Go 怪奇組 / Let's Go Kaiki-gumi",
      normalizedTitle: "let's go 怪奇组",
      aliases: ["Let's Go 怪奇組 / Let's Go Kaiki-gumi"],
      season: 1,
    };

    expect(createMediaIdentityKeys(romanizedGroup)).toContain("letsgokaikigumi");
    expect(mediaIdentitiesOverlap(localizedGroup, romanizedGroup)).toBe(true);
    expect(mediaIdentitiesShareStrongKey(localizedGroup, romanizedGroup)).toBe(true);
  });

  it("does not merge unrelated romanized titles after punctuation normalization", () => {
    expect(
      mediaIdentitiesOverlap(
        { mediaType: "ANIME", title: "Let's Go Kaiki-gumi", season: 1 },
        { mediaType: "ANIME", title: "Let's Go Karaoke!", season: 1 },
      ),
    ).toBe(false);
  });

  it("does not treat a franchise title as a strong match for a spin-off", () => {
    expect(
      mediaIdentitiesShareStrongKey(
        {
          mediaType: "ANIME",
          displayTitle: "海贼王 / One Piece",
          normalizedTitle: "海贼王",
          season: 1,
        },
        {
          mediaType: "ANIME",
          displayTitle: "海贼王 女英雄们的故事 / One Piece: Heroines",
          normalizedTitle: "海贼王 女英雄们的故事",
          season: 1,
        },
      ),
    ).toBe(false);
  });

  it("removes movie packaging tokens from canonical keys", () => {
    expect(
      mediaIdentitiesOverlap(
        {
          mediaType: "MOVIE",
          displayTitle: "剧场版 关于我转生变成史莱姆这档事 苍海之泪篇 / TenSura Movie 2: Soukai no Namida hen 电影",
          season: 1,
        },
        {
          mediaType: "MOVIE",
          displayTitle: "剧场版 关于我转生变成史莱姆这档事 苍海之泪篇 电影",
          season: 1,
        },
      ),
    ).toBe(true);
  });

  it("trusts subscription title over a mismatched bound candidate group", () => {
    const subscription = {
      mediaType: "ANIME",
      title: "弱弱老师 放送版 / Yowayowa Sensei On-air version",
      seasonMode: "specific",
      seasonNumber: 1,
      candidateGroup: {
        mediaType: "ANIME",
        displayTitle: "大贤者里德尔的时间逆行",
        normalizedTitle: "大贤者里德尔的时间逆行",
        season: 1,
      },
    };

    expect(
      subscriptionCoversCandidateGroup(subscription, {
        mediaType: "ANIME",
        displayTitle: "弱弱老师 / Yowayowa Sensei",
        normalizedTitle: "弱弱老师",
        season: 1,
      }),
    ).toBe(true);
    expect(
      subscriptionCoversCandidateGroup(subscription, {
        mediaType: "ANIME",
        displayTitle: "大贤者里德尔的时间逆行",
        normalizedTitle: "大贤者里德尔的时间逆行",
        season: 1,
      }),
    ).toBe(false);
  });

  it("does not match unrelated batch groups through numeric range aliases", () => {
    expect(
      subscriptionCoversCandidateGroup(
        {
          mediaType: "ANIME",
          title: "躲在超市后门抽烟的两人 / Super no Ura de Yani Suu Futari",
          seasonMode: "specific",
          seasonNumber: 1,
          candidateGroup: {
            mediaType: "ANIME",
            displayTitle: "01-12 先行版合集",
            normalizedTitle: "01 12 先行版合集",
            aliases: [
              "01-12 先行版合集",
              "躲在超市后门抽烟的两人 / Super no Ura de Yani Suu Futari",
            ],
            season: 1,
          },
        },
        {
          mediaType: "ANIME",
          displayTitle: "僵尸哪有那么萌？/Sankarea S01 | 01-12+SPx3",
          normalizedTitle: "僵尸哪有那么萌 /sankarea",
          aliases: ["僵尸哪有那么萌？/Sankarea S01 | 01-12+SPx3"],
          season: 1,
        },
      ),
    ).toBe(false);
  });

  it("does not spread polluted bound group aliases to unrelated titles", () => {
    expect(
      subscriptionCoversCandidateGroup(
        {
          mediaType: "ANIME",
          title: "鸭乃桥论的禁忌推理",
          seasonMode: "specific",
          seasonNumber: 1,
          candidateGroup: {
            mediaType: "ANIME",
            displayTitle: "Love Live！虹咲学园 学园偶像同好会",
            normalizedTitle: "love live 虹咲学园 学园偶像同好会",
            aliases: [
              "鸭乃桥论的禁忌推理/Ron Kamonohashi's Forbidden Deductions S01",
              "Silent Witch 沉默魔女的秘密/Silent Witch Chinmoku no Majo no Kakushigoto S01",
            ],
            season: 1,
          },
        },
        {
          mediaType: "ANIME",
          displayTitle: "Silent Witch 沉默魔女的秘密 / Silent Witch - Chinmoku no Majo no Kakushigoto",
          normalizedTitle: "silent witch 沉默魔女的秘密",
          aliases: [
            "Silent Witch 沉默魔女的秘密 / Silent Witch - Chinmoku no Majo no Kakushigoto",
          ],
          season: 1,
        },
      ),
    ).toBe(false);
  });

  it("excludes historical aliases from candidate group identity matching", () => {
    const pollutedGroup = candidateGroupIdentityInput({
      mediaType: "ANIME",
      displayTitle: "无关作品",
      normalizedTitle: "无关作品",
      aliases: ["龙王的工作", "Let's Go Kaiki-gumi"],
      season: 1,
    });

    expect(
      subscriptionCoversCandidateGroup(
        {
          mediaType: "ANIME",
          title: "龙王的工作",
          seasonMode: "specific",
          seasonNumber: 1,
        },
        pollutedGroup,
      ),
    ).toBe(false);
  });

  it("keeps prepared subscription coverage equivalent to direct matching", () => {
    const subscription = {
      mediaType: "ANIME" as const,
      title: "葬送的芙莉莲 / Sousou no Frieren",
      seasonMode: "specific",
      seasonNumber: 2,
      candidateGroup: {
        mediaType: "ANIME" as const,
        displayTitle: "葬送的芙莉莲 第二季 / Sousou no Frieren Season 2",
        normalizedTitle: "葬送的芙莉莲 sousou no frieren",
        aliases: ["Sousou no Frieren S2"],
        season: 2,
      },
    };
    const groups = [
      {
        mediaType: "ANIME" as const,
        displayTitle: "葬送的芙莉莲 第二季",
        normalizedTitle: "葬送的芙莉莲",
        season: 2,
      },
      {
        mediaType: "ANIME" as const,
        displayTitle: "葬送的芙莉莲",
        normalizedTitle: "葬送的芙莉莲",
        season: 1,
      },
      {
        mediaType: "ANIME" as const,
        displayTitle: "无关作品",
        normalizedTitle: "无关作品",
        season: 2,
      },
    ];
    const prepared = prepareSubscriptionCoverage(subscription);

    expect(
      groups.map((group) =>
        preparedSubscriptionCoversCandidateGroup(prepared, createMediaIdentity(group)),
      ),
    ).toEqual(groups.map((group) => subscriptionCoversCandidateGroup(subscription, group)));
  });
});
