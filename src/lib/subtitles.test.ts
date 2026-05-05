import { describe, expect, it } from "vitest";
import { inferSubtitleLanguage, subtitleMatchesMediaFile } from "./subtitles";

describe("inferSubtitleLanguage", () => {
  it("detects common anime subtitle language tags", () => {
    expect(inferSubtitleLanguage("Episode 01.zh-Hans.srt")).toBe("zh-Hans");
    expect(inferSubtitleLanguage("Episode 01.CHT.ass")).toBe("zh-Hant");
    expect(inferSubtitleLanguage("Episode 01.简繁.vtt")).toBe("zh");
    expect(inferSubtitleLanguage("Episode 01.jpn.srt")).toBe("ja");
    expect(inferSubtitleLanguage("Episode 01.English.srt")).toBe("en");
  });
});

describe("subtitleMatchesMediaFile", () => {
  const mediaFile = {
    originalName: "[ANi] Some Anime - 04 [1080P][CHT].mp4",
    absolutePath: "/data/library/anime/Some Anime/Season 01/[ANi] Some Anime - 04 [1080P][CHT].mp4",
    episode: { number: 4 },
  };

  it("matches same-stem sidecar subtitles", () => {
    expect(
      subtitleMatchesMediaFile("[ANi] Some Anime - 04 [1080P][CHT].zh-Hant.srt", mediaFile),
    ).toBe(true);
  });

  it("matches episode-numbered subtitles in season directories", () => {
    expect(subtitleMatchesMediaFile("Some Anime - 04.ass", mediaFile)).toBe(true);
    expect(subtitleMatchesMediaFile("Some Anime - 05.ass", mediaFile)).toBe(false);
  });
});
