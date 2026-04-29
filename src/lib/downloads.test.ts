import { describe, expect, it } from "vitest";
import { isMetadataOnlyAria2Status, selectTargetPath } from "./downloads";

describe("aria2 download helpers", () => {
  it("selects the largest video file and ignores metadata", () => {
    expect(
      selectTargetPath([
        { path: "[METADATA]", length: "1393" },
        { path: "/data/downloads/sample.txt", length: "999999" },
        { path: "/data/downloads/episode.mkv", length: "100" },
        { path: "/data/downloads/episode.mp4", length: "200" },
      ]),
    ).toBe("/data/downloads/episode.mp4");
  });

  it("detects metadata-only magnet tasks with followed downloads", () => {
    expect(
      isMetadataOnlyAria2Status({
        gid: "metadata",
        status: "complete",
        followedBy: ["video"],
        files: [{ path: "[METADATA]", length: "1393" }],
      }),
    ).toBe(true);
    expect(
      isMetadataOnlyAria2Status({
        gid: "video",
        status: "complete",
        files: [{ path: "/data/downloads/episode.mp4", length: "200" }],
      }),
    ).toBe(false);
  });
});
