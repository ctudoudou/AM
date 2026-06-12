import { describe, expect, it } from "vitest";
import { assertImportRootInsideDataRoot, parseImportReleaseFromPath } from "./import-scan";

describe("import scan", () => {
  it("parses anime release identity from a local filename", () => {
    const parsed = parseImportReleaseFromPath(
      "/data/imports/[Subs] Awajima Hyakkei - 03 [1080p][HEVC].mkv",
      "ANIME",
    );

    expect(parsed.mediaType).toBe("ANIME");
    expect(parsed.parsedTitle).toBe("Awajima Hyakkei");
    expect(parsed.episodeNumber).toBe(3);
    expect(parsed.resolution).toBe("1080p");
    expect(parsed.codec).toBe("HEVC");
  });

  it("parses TV season and episode from a local filename", () => {
    const parsed = parseImportReleaseFromPath(
      "/data/imports/Show.Name.S02E07.1080p.WEB-DL.mkv",
      "TV",
    );

    expect(parsed.mediaType).toBe("TV");
    expect(parsed.parsedTitle).toBe("Show Name");
    expect(parsed.season).toBe(2);
    expect(parsed.episodeNumber).toBe(7);
  });

  it("uses the import series directory as the title when filenames are release-like", () => {
    const parsed = parseImportReleaseFromPath(
      "/data/import/拾荒者统治/Scavengers.Reign.S01E01.1080p.WEB.h264-EDITH[eztv.re].chs.eng.mp4",
      "TV",
    );

    expect(parsed.mediaType).toBe("TV");
    expect(parsed.parsedTitle).toBe("拾荒者统治");
    expect(parsed.normalizedTitle).toBe("拾荒者统治");
    expect(parsed.season).toBe(1);
    expect(parsed.episodeNumber).toBe(1);
  });

  it("uses the nearest non-season import directory as the anime title hint", () => {
    const parsed = parseImportReleaseFromPath(
      "/data/import/自称贤者弟子的贤者/Season 1/Kenja no Deshi o Nanoru Kenja [09].mkv",
      "ANIME",
    );

    expect(parsed.mediaType).toBe("ANIME");
    expect(parsed.parsedTitle).toBe("自称贤者弟子的贤者");
    expect(parsed.normalizedTitle).toBe("自称贤者弟子的贤者");
    expect(parsed.season).toBe(1);
    expect(parsed.episodeNumber).toBe(9);
  });

  it("rejects import roots outside DATA_ROOT", () => {
    expect(() => assertImportRootInsideDataRoot("/mnt/user/other", "/data")).toThrow(
      "Import path must be inside DATA_ROOT",
    );
    expect(assertImportRootInsideDataRoot("/data/imports", "/data")).toBe("/data/imports");
  });
});
