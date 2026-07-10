import { describe, expect, it } from "vitest";
import {
  latestCandidateWindowSize,
  shouldUseLatestCandidateWindow,
} from "./subscription-candidate-window";

describe("subscription candidate window", () => {
  it("uses the bounded latest window for the default and batch queue", () => {
    for (const category of ["ALL", "BATCH"] as const) {
      expect(
        shouldUseLatestCandidateWindow({
          category,
          filterCanonicalCoverage: true,
          mediaType: null,
          query: "",
          sort: "LATEST",
          status: "ALL",
        }),
      ).toBe(true);
    }
  });

  it("keeps filtered searches on the exact query path", () => {
    expect(
      shouldUseLatestCandidateWindow({
        category: "ALL",
        filterCanonicalCoverage: true,
        mediaType: "ANIME",
        query: "kura",
        sort: "LATEST",
        status: "ALL",
      }),
    ).toBe(false);
  });

  it("keeps the relation expansion window small and bounded", () => {
    expect(latestCandidateWindowSize(0, 5)).toBe(60);
    expect(latestCandidateWindowSize(0, 50)).toBe(180);
    expect(latestCandidateWindowSize(500, 50)).toBe(300);
  });
});
