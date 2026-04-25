import { describe, expect, it } from "vitest";
import { assertInsideAllowedRoots } from "./env";

describe("assertInsideAllowedRoots", () => {
  it("allows paths inside configured media roots", () => {
    expect(assertInsideAllowedRoots("/data/library/anime/Series")).toBe(
      "/data/library/anime/Series",
    );
  });

  it("rejects paths outside configured media roots", () => {
    expect(() => assertInsideAllowedRoots("/etc/passwd")).toThrow(
      "outside configured Kura roots",
    );
  });
});

