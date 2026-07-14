import { describe, expect, it } from "vitest";
import { readAnimeLibraryFilters, writeAnimeLibraryFilters } from "./anime-library-filters";

describe("anime library filters", () => {
  it("reads shareable filter state from the URL", () => {
    expect(readAnimeLibraryFilters("?q=frieren&year=2023&tag=IN_PROGRESS&sort=TITLE")).toEqual({
      query: "frieren",
      year: "2023",
      tag: "IN_PROGRESS",
      sort: "TITLE",
    });
  });

  it("preserves unrelated query parameters and removes defaults", () => {
    expect(
      writeAnimeLibraryFilters("?view=grid&q=old", {
        query: "",
        year: "ALL",
        tag: "MISSING_POSTER",
        sort: "UPDATED_DESC",
      }),
    ).toBe("?view=grid&tag=MISSING_POSTER");
  });
});
