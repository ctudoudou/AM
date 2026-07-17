import { describe, expect, it } from "vitest";
import {
  buildDownloadDiagnostics,
  classifyDownloadStall,
  deriveDownloadProgressHealth,
  extractBtInfoHash,
  isCompleteDownloadFileSize,
  isMetadataOnlyAria2Status,
  isRecoverableDownloadError,
  normalizeBtInfoHash,
  selectTargetPath,
} from "./downloads";

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

  it("recognizes aria2 metadata paths that include the info hash suffix", () => {
    expect(
      buildDownloadDiagnostics({
        aria2Gid: "metadata",
        status: "ACTIVE",
        aria2Files: [{ path: `[METADATA]${"a".repeat(40)}`, length: "0" }],
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

  it("classifies metadata and payload stalls with separate thresholds", () => {
    const now = new Date("2026-07-17T12:00:00.000Z").getTime();

    expect(
      classifyDownloadStall(
        {
          status: "ACTIVE",
          metadataOnly: true,
          stalledSince: "2026-07-17T05:00:00.000Z",
        },
        now,
      ),
    ).toBe("cooling");
    expect(
      classifyDownloadStall(
        {
          status: "ACTIVE",
          metadataOnly: true,
          stalledSince: "2026-07-16T11:00:00.000Z",
        },
        now,
      ),
    ).toBe("needs_source");
    expect(
      classifyDownloadStall(
        {
          status: "ACTIVE",
          metadataOnly: false,
          stalledSince: "2026-07-14T11:00:00.000Z",
        },
        now,
      ),
    ).toBe("blocked");
  });

  it("resets stall tracking on byte progress and starts it on a zero-speed sync", () => {
    const now = new Date("2026-07-17T12:00:00.000Z");
    expect(
      deriveDownloadProgressHealth({
        previousCompletedBytes: BigInt(10),
        nextCompletedBytes: BigInt(20),
        previousLastProgressAt: null,
        previousStalledSince: new Date("2026-07-17T10:00:00.000Z"),
        nextStatus: "ACTIVE",
        downloadSpeed: BigInt(0),
        now,
      }),
    ).toEqual({ lastProgressAt: now, stalledSince: null });

    expect(
      deriveDownloadProgressHealth({
        previousCompletedBytes: BigInt(20),
        nextCompletedBytes: BigInt(20),
        previousLastProgressAt: now,
        previousStalledSince: null,
        nextStatus: "ACTIVE",
        downloadSpeed: BigInt(0),
        now,
      }),
    ).toEqual({ lastProgressAt: now, stalledSince: now });
  });

  it("extracts and normalizes info hashes from aria2 duplicate errors and magnets", () => {
    expect(
      extractBtInfoHash(
        "InfoHash 2a6dd0d0939addcb075c3b55e55e180c05301b03 is already registered.",
      ),
    ).toBe("2a6dd0d0939addcb075c3b55e55e180c05301b03");
    expect(
      extractBtInfoHash("magnet:?xt=urn:btih:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
    ).toBe("0000000000000000000000000000000000000000");
    expect(
      extractBtInfoHash("magnet:?xt=urn%3Abtih%3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
    ).toBe("0000000000000000000000000000000000000000");
    expect(normalizeBtInfoHash("not-a-hash")).toBeNull();
  });

  it("recognizes download errors that can be recovered by aria2 or existing files", () => {
    expect(isRecoverableDownloadError("aria2 task is not available: fetch failed")).toBe(true);
    expect(
      isRecoverableDownloadError(
        "InfoHash 2a6dd0d0939addcb075c3b55e55e180c05301b03 is already registered.",
      ),
    ).toBe(true);
    expect(
      isRecoverableDownloadError(
        "File /data/downloads/episode.mkv exists, but a control file(*.aria2) does not exist.",
      ),
    ).toBe(true);
    expect(
      isRecoverableDownloadError(
        "Failed to make the directory /data/downloads, cause: Permission denied",
      ),
    ).toBe(true);
    expect(isRecoverableDownloadError("Reached max-file-not-found count=10")).toBe(true);
    expect(isRecoverableDownloadError("")).toBe(true);
  });

  it("does not mark an existing partial or unknown-length target as complete", () => {
    expect(isCompleteDownloadFileSize(BigInt(100), BigInt(100))).toBe(true);
    expect(isCompleteDownloadFileSize(BigInt(99), BigInt(100))).toBe(false);
    expect(isCompleteDownloadFileSize(BigInt(100), BigInt(0))).toBe(false);
  });
});
