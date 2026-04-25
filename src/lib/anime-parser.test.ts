import { describe, expect, it } from "vitest";
import { parseAnimeReleaseTitle } from "./anime-parser";

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
});
