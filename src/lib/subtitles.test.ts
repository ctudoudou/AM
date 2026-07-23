import { describe, expect, it } from "vitest";
import {
  buildEmbeddedSubtitleLabel,
  buildSubtitleTranslationBatches,
  embeddedSubtitleOutputFormatForCodec,
  embeddedSubtitleStreamsFromProbe,
  formatWebVtt,
  inferEmbeddedSubtitleLanguage,
  inferSubtitleLanguage,
  parseWebVtt,
  subtitleFormatForCodec,
  subtitleMatchesMediaFile,
  validateTranslatedCueBatch,
} from "./subtitles";

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

describe("embedded subtitle helpers", () => {
  it("parses supported subtitle streams from ffprobe output", () => {
    const streams = embeddedSubtitleStreamsFromProbe(
      JSON.stringify({
        streams: [
          { index: 0, codec_name: "h264", codec_type: "video" },
          {
            index: 2,
            codec_name: "ass",
            codec_type: "subtitle",
            tags: { language: "eng", title: "English" },
          },
          {
            index: 3,
            codec_name: "hdmv_pgs_subtitle",
            codec_type: "subtitle",
            tags: { language: "jpn" },
          },
        ],
      }),
    );

    expect(streams).toEqual([
      {
        index: 2,
        codec_name: "ass",
        codec_type: "subtitle",
        tags: { language: "eng", title: "English" },
      },
    ]);
  });

  it("normalizes embedded subtitle formats and languages", () => {
    expect(subtitleFormatForCodec("ass")).toBe("ass");
    expect(subtitleFormatForCodec("subrip")).toBe("srt");
    expect(subtitleFormatForCodec("webvtt")).toBe("vtt");
    expect(subtitleFormatForCodec("hdmv_pgs_subtitle")).toBeNull();
    expect(embeddedSubtitleOutputFormatForCodec("ass")).toBe("vtt");
    expect(embeddedSubtitleOutputFormatForCodec("hdmv_pgs_subtitle")).toBeNull();
    expect(inferEmbeddedSubtitleLanguage({ tags: { language: "eng" } })).toBe("en");
    expect(inferEmbeddedSubtitleLanguage({ tags: { language: "ger" } })).toBe("de");
    expect(inferEmbeddedSubtitleLanguage({ tags: { title: "繁體中文" } })).toBe("zh-Hant");
  });

  it("builds readable embedded subtitle labels", () => {
    expect(
      buildEmbeddedSubtitleLabel(
        { index: 2, tags: { language: "eng", title: "English" } },
        "en",
        "ass",
      ),
    ).toBe("English · ASS");
    expect(buildEmbeddedSubtitleLabel({ index: 3, tags: {} }, "zh-Hans", "srt")).toBe(
      "简体中文 · SRT",
    );
  });
});

describe("subtitle translation helpers", () => {
  it("batches cues by both cue count and payload size", () => {
    expect(
      buildSubtitleTranslationBatches(
        [
          { index: 0, text: "1234" },
          { index: 1, text: "5678" },
          { index: 2, text: "90" },
        ],
        { maxCues: 2, maxCharacters: 6 },
      ),
    ).toEqual([
      [{ index: 0, text: "1234" }],
      [{ index: 1, text: "5678" }, { index: 2, text: "90" }],
    ]);
  });

  it("rejects duplicate indexes returned by the LLM", () => {
    expect(() =>
      validateTranslatedCueBatch(
        [
          { index: 0, text: "Hello" },
          { index: 1, text: "World" },
        ],
        [
          { index: 0, text: "你好" },
          { index: 0, text: "世界" },
        ],
      ),
    ).toThrow("duplicate cue index");
  });
});

describe("WebVTT helpers", () => {
  it("parses and formats cues without changing timings", () => {
    const parsed = parseWebVtt(`WEBVTT

cue-1
00:00:01.000 --> 00:00:03.000
Hello
there

00:00:04.000 --> 00:00:05.000 align:start
Next line
`);

    expect(parsed.cues).toEqual([
      {
        id: "cue-1",
        timing: "00:00:01.000 --> 00:00:03.000",
        text: "Hello\nthere",
      },
      {
        id: null,
        timing: "00:00:04.000 --> 00:00:05.000 align:start",
        text: "Next line",
      },
    ]);
    expect(
      formatWebVtt({
        cues: parsed.cues.map((cue) =>
          cue.id === "cue-1" ? { ...cue, text: "你好\n呀" } : cue,
        ),
      }),
    ).toContain("00:00:01.000 --> 00:00:03.000\n你好\n呀");
  });
});
