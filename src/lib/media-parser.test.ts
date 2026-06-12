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

  it("strips video file extensions from movie titles", () => {
    expect(
      parseMediaReleaseTitle(
        "与王生活的男人 The Kings Warden [1080p][X264].mkv",
        "MOVIE",
      ).parsedTitle,
    ).toBe("与王生活的男人 The Kings Warden");
    expect(
      parseMediaReleaseTitle(
        "与王生活的男人.The.Kings.Warden.2026.WEB-DL.1080p.X264.mkv",
        "MOVIE",
      ).parsedTitle,
    ).toBe("与王生活的男人 The Kings Warden");
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

  it("drops TV release groups and subtitle language tails from parsed titles", () => {
    const parsed = parseMediaReleaseTitle(
      "Scavengers.Reign.S01E01.1080p.WEB.h264-EDITH[eztv.re].chs.eng",
      "TV",
    );

    expect(parsed.mediaType).toBe("TV");
    expect(parsed.parsedTitle).toBe("Scavengers Reign");
    expect(parsed.season).toBe(1);
    expect(parsed.episodeNumber).toBe(1);
    expect(parsed.resolution).toBe("1080p");
    expect(parsed.codec).toBe("H264");
  });

  it("auto-detects obvious non-anime releases", () => {
    expect(detectMediaType("The.Studio.S01E03.1080p.WEB-DL")).toBe("TV");
    expect(detectMediaType("Oppenheimer.2023.2160p.BluRay.x265")).toBe("MOVIE");
  });

  it("treats explicit anime theatrical releases as movies even from anime intake", () => {
    const parsed = parseMediaReleaseTitle(
      "劇場版 ゾンビランドサガ ゆめぎんがパラダイス",
      "ANIME",
    );

    expect(parsed.mediaType).toBe("MOVIE");
    expect(detectMediaType("Zombie Land Saga The Movie 2026 1080p BDRip")).toBe("MOVIE");
  });
});
