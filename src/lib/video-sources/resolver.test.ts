import { describe, expect, it } from "vitest";
import { selectMediaCandidate } from "./resolver";

describe("video source resolver candidate selection", () => {
  it("prefers a direct MP4 and ignores likely advertising media", () => {
    const selected = selectMediaCandidate([
      {
        url: "https://cdn.example.test/preroll-ad.mp4",
        format: "mp4",
        contentType: "video/mp4",
        sizeBytes: BigInt(500_000_000),
        requestHeaders: {},
      },
      {
        url: "https://cdn.example.test/master.m3u8",
        format: "hls",
        contentType: "application/vnd.apple.mpegurl",
        sizeBytes: null,
        requestHeaders: {},
      },
      {
        url: "https://cdn.example.test/episode",
        format: "mp4",
        contentType: "video/mp4",
        sizeBytes: BigInt(100_000_000),
        requestHeaders: {},
      },
    ]);

    expect(selected?.url).toBe("https://cdn.example.test/episode");
  });
});
