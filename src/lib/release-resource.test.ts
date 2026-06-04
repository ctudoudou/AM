import { describe, expect, it } from "vitest";
import { classifyReleaseResource } from "./release-resource";

describe("classifyReleaseResource", () => {
  it("rejects anime music and album releases without video signals", () => {
    expect(
      classifyReleaseResource(
        "[2026.06.03] TVアニメ「Apocalypse Hotel」EDテーマ「Capsule」／aiko [FLAC 48kHz/24bit]",
      ).kind,
    ).toBe("NON_VIDEO");
    expect(
      classifyReleaseResource(
        "中島 美嘉 - 雪の華15周年記念ベスト盤 BIBLE (2019) [16bit/44.1kHz FLAC]",
      ).kind,
    ).toBe("NON_VIDEO");
    expect(
      classifyReleaseResource(
        "[JMAX] TVアニメ「Some Anime」オリジナルサウンドトラック [CD][FLAC]",
      ).kind,
    ).toBe("NON_VIDEO");
  });

  it("keeps playable anime releases that contain FLAC or MKV metadata", () => {
    expect(
      classifyReleaseResource(
        "[Nekomoe kissaten&VCB-Studio] Apocalypse Hotel [01][Ma10p_1080p][x265_flac].mkv",
      ).kind,
    ).toBe("VIDEO");
    expect(
      classifyReleaseResource(
        "[Dynamis One] IyaPan R - 06 (B-Global 1920x1080 HEVC AAC MKV)",
      ).kind,
    ).toBe("VIDEO");
  });
});
