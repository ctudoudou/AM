import { describe, expect, it } from "vitest";
import { parseLibraryIdentity, shouldPromoteScannedTitle } from "./library-scan";

describe("parseLibraryIdentity", () => {
  it("uses the series directory for videos stored under season extras", () => {
    const parsed = parseLibraryIdentity(
      "/data/library/anime/WataMote No Matter How I Look At It, It's You Guys' Fault I'm Not Popular! (2013)/Season 01/EXTRA/[Moozzi2] Watamote [SP01] NCOP - 01.mkv",
      { type: "ANIME", root: "/data/library/anime" },
    );

    expect(parsed.title).toBe("WataMote No Matter How I Look At It, It's You Guys' Fault I'm Not Popular!");
    expect(parsed.year).toBe(2013);
    expect(parsed.season).toBe(1);
  });

  it("skips supplemental folders even when there is no season directory", () => {
    const parsed = parseLibraryIdentity(
      "/data/library/anime/Some Anime/Extras/NCOP/Some Anime NCOP.mkv",
      { type: "ANIME", root: "/data/library/anime" },
    );

    expect(parsed.title).toBe("Some Anime");
  });
});

describe("shouldPromoteScannedTitle", () => {
  it("promotes a scanned movie title when the existing title only has video extension noise", () => {
    expect(
      shouldPromoteScannedTitle(
        "与王生活的男人 The Kings Warden mkv",
        "与王生活的男人 The Kings Warden",
      ),
    ).toBe(true);
  });

  it("does not replace curated titles with unrelated scanned titles", () => {
    expect(
      shouldPromoteScannedTitle(
        "Zombie Land Saga: Yumeginga Paradise",
        "Zombie Land Saga Yumeginga Paradise",
      ),
    ).toBe(false);
  });
});
