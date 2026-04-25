import { describe, expect, it } from "vitest";
import { detectMediaType, parseMediaReleaseTitle } from "./media-parser";

describe("parseMediaReleaseTitle", () => {
  it("parses movie releases without anime episode assumptions", () => {
    const parsed = parseMediaReleaseTitle(
      "Dune.Part.Two.2024.2160p.WEB-DL.x265.DDP5.1",
      "MOVIE",
    );

    expect(parsed.mediaType).toBe("MOVIE");
    expect(parsed.parsedTitle).toBe("Dune Part Two");
    expect(parsed.year).toBe(2024);
    expect(parsed.season).toBe(1);
    expect(parsed.episodeNumber).toBe(1);
    expect(parsed.resolution).toBe("2160p");
    expect(parsed.codec).toBe("X265");
  });

  it("parses TV season and episode releases", () => {
    const parsed = parseMediaReleaseTitle(
      "Slow.Horses.S04E02.1080p.WEB-DL.H264.AAC",
      "TV",
    );

    expect(parsed.mediaType).toBe("TV");
    expect(parsed.parsedTitle).toBe("Slow Horses");
    expect(parsed.season).toBe(4);
    expect(parsed.episodeNumber).toBe(2);
    expect(parsed.sourceKind).toBe("WEB-DL");
  });

  it("auto-detects obvious non-anime releases", () => {
    expect(detectMediaType("The.Studio.S01E03.1080p.WEB-DL")).toBe("TV");
    expect(detectMediaType("Oppenheimer.2023.2160p.BluRay.x265")).toBe("MOVIE");
  });
});
