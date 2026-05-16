import { describe, expect, it } from "vitest";
import { buildDownloadDiagnostics, isMetadataOnlyAria2Status, selectTargetPath } from "./downloads";

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

  it("explains metadata-only waiting downloads", () => {
    expect(
      buildDownloadDiagnostics({
        aria2Gid: "metadata",
        status: "WAITING",
        aria2Files: [{ path: "[METADATA]", length: "1393" }],
      }),
    ).toMatchObject({
      reason: "metadata",
      metadataOnly: true,
      visibleFileCount: 0,
    });
  });

  it("explains active downloads with no speed as peer waits", () => {
    expect(
      buildDownloadDiagnostics({
        aria2Gid: "video",
        status: "ACTIVE",
        totalBytes: "1000",
        completedBytes: "200",
        downloadSpeed: "0",
        aria2Files: [{ path: "/data/downloads/episode.mp4", length: "1000" }],
      }).reason,
    ).toBe("no_peers");
  });

  it("computes ETA from stored byte counters and speed", () => {
    expect(
      buildDownloadDiagnostics({
        aria2Gid: "video",
        status: "ACTIVE",
        totalBytes: BigInt(1000),
        completedBytes: BigInt(250),
        downloadSpeed: BigInt(50),
      }).etaSeconds,
    ).toBe(15);
  });
});
