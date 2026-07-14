import { describe, expect, it } from "vitest";
import { filterLibrarySearchItems, type LibrarySearchItem } from "./library-search";

const items: LibrarySearchItem[] = [
  {
    id: "anime-1",
    mediaType: "ANIME",
    displayTitle: "葬送的芙莉莲",
    primaryTitle: "Sousou no Frieren",
    secondaryTitles: ["Frieren"],
  },
  {
    id: "movie-1",
    mediaType: "MOVIE",
    displayTitle: "Frieren Movie",
    primaryTitle: "Frieren Movie",
  },
  {
    id: "tv-1",
    mediaType: "TV",
    displayTitle: "Scavengers Reign",
    primaryTitle: "Scavengers Reign",
  },
];

describe("filterLibrarySearchItems", () => {
  it("matches localized, primary, and alternate titles", () => {
    expect(filterLibrarySearchItems(items, "芙莉莲").map((item) => item.id)).toEqual(["anime-1"]);
    expect(filterLibrarySearchItems(items, "sousou").map((item) => item.id)).toEqual(["anime-1"]);
    expect(filterLibrarySearchItems(items, "frieren").map((item) => item.id)).toEqual([
      "anime-1",
      "movie-1",
    ]);
  });

  it("returns no results for an empty query and respects the result limit", () => {
    expect(filterLibrarySearchItems(items, " ")).toEqual([]);
    expect(filterLibrarySearchItems(items, "frieren", 1)).toHaveLength(1);
  });
});
