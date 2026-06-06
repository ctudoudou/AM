import { describe, expect, it } from "vitest";
import { shouldPromoteScannedTitle } from "./library-scan";

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
