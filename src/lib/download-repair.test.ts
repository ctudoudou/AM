import { describe, expect, it } from "vitest";
import type { Aria2Status } from "@/lib/aria2";
import {
  buildDownloadRepairPlan,
  resolveDownloadPathInsideRoot,
  type DownloadRepairArtifact,
  type DownloadRepairRecord,
} from "./download-repair";

const missingArtifact: DownloadRepairArtifact = {
  targetState: "missing",
  expectedBytes: "100",
  actualBytes: "0",
  controlFileExists: false,
  savedTorrentExists: false,
};

function download(overrides: Partial<DownloadRepairRecord> = {}): DownloadRepairRecord {
  return {
    id: "download-1",
    candidateId: "candidate-1",
    aria2Gid: "old-gid",
    infoHash: null,
    status: "FAILED",
    sourceUrl: "magnet:?xt=urn:btih:1111111111111111111111111111111111111111",
    targetPath: "/data/downloads/episode.mkv",
    title: "Episode",
    totalBytes: BigInt(100),
    aria2Files: [
      { path: "/data/downloads/episode.mkv", length: "100", completedLength: "0" },
    ],
    errorMessage: "aria2 task is not available: aria2 request failed: 400",
    repairNote: null,
    supersededById: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function aria2(overrides: Partial<Aria2Status> = {}): Aria2Status {
  return {
    gid: "new-gid",
    status: "active",
    infoHash: "1111111111111111111111111111111111111111",
    files: [{ path: "/data/downloads/episode.mkv", length: "100" }],
    ...overrides,
  };
}

function plan(input: {
  downloads?: DownloadRepairRecord[];
  knownAria2?: Aria2Status[];
  artifacts?: Map<string, DownloadRepairArtifact>;
}) {
  return buildDownloadRepairPlan({
    downloads: input.downloads ?? [download()],
    knownAria2: input.knownAria2 ?? [],
    downloadsDir: "/data/downloads",
    artifacts: input.artifacts ?? new Map([["download-1", missingArtifact]]),
  });
}

describe("download repair planning", () => {
  it("synchronizes a failed record when its current aria2 GID still exists", () => {
    const result = plan({ knownAria2: [aria2({ gid: "old-gid" })] });

    expect(result.items[0]).toMatchObject({
      kind: "sync_existing_gid",
      confidence: "high",
      executable: true,
    });
  });

  it("marks a target complete only after disk size reaches the expected length", () => {
    const artifact: DownloadRepairArtifact = {
      ...missingArtifact,
      targetState: "complete",
      actualBytes: "100",
    };
    const result = plan({ artifacts: new Map([["download-1", artifact]]) });

    expect(result.items[0].kind).toBe("mark_completed");
  });

  it("adopts the single aria2 task with the same persisted info hash", () => {
    const result = plan({
      downloads: [download({ infoHash: "2222222222222222222222222222222222222222" })],
      knownAria2: [
        aria2({
          gid: "replacement",
          infoHash: "2222222222222222222222222222222222222222",
          files: [{ path: "/data/downloads/other.mkv" }],
        }),
      ],
    });

    expect(result.items[0]).toMatchObject({
      kind: "adopt_aria2_gid",
      replacementGid: "replacement",
    });
  });

  it("supersedes a metadata GID when its followed task already has a canonical record", () => {
    const duplicate = download({ id: "metadata", aria2Gid: "metadata-gid" });
    const canonical = download({
      id: "canonical",
      aria2Gid: "final-gid",
      status: "ACTIVE",
      sourceUrl: "magnet:?xt=urn:btih:2222222222222222222222222222222222222222",
    });
    const result = plan({
      downloads: [duplicate, canonical],
      knownAria2: [
        aria2({ gid: "metadata-gid", status: "complete", followedBy: ["final-gid"] }),
        aria2({ gid: "final-gid", status: "active" }),
      ],
    });

    expect(result.items[0]).toMatchObject({
      kind: "supersede_duplicate",
      canonicalDownloadId: "canonical",
    });
  });

  it("sends a failed aria2 task to review after its controlled source retry is exhausted", () => {
    const result = plan({
      downloads: [
        download({
          repairNote: "Controlled source retry completed, but aria2 could not find the file.",
        }),
      ],
      knownAria2: [
        aria2({
          gid: "old-gid",
          status: "error",
          errorMessage: "Reached max-file-not-found count=10",
        }),
      ],
    });

    expect(result.items[0]).toMatchObject({
      kind: "manual_review",
      confidence: "low",
      executable: false,
    });
  });

  it("keeps one canonical retry and supersedes later records for the same source", () => {
    const first = download({ id: "first", aria2Gid: "old-first" });
    const second = download({
      id: "second",
      aria2Gid: "old-second",
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
      errorMessage: "Duplicate aria2 task is already tracked by download first.",
    });
    const result = plan({
      downloads: [first, second],
      artifacts: new Map([
        ["first", missingArtifact],
        ["second", missingArtifact],
      ]),
    });
    const firstAction = result.items.find((item) => item.downloadId === "first");
    const secondAction = result.items.find((item) => item.downloadId === "second");

    expect(firstAction?.kind).toBe("retry_source");
    expect(secondAction).toMatchObject({
      kind: "supersede_duplicate",
      canonicalDownloadId: "first",
      dependsOnActionId: firstAction?.actionId,
    });
  });

  it("requires review when more than one aria2 task matches the same identity", () => {
    const result = plan({
      knownAria2: [aria2({ gid: "match-1" }), aria2({ gid: "match-2" })],
    });

    expect(result.items[0]).toMatchObject({
      kind: "manual_review",
      executable: false,
    });
  });

  it("produces a stable plan ID for the same repair snapshot", () => {
    const first = plan({});
    const second = plan({});

    expect(first.planId).toBe(second.planId);
  });
});

describe("download repair path safety", () => {
  it("accepts targets inside DOWNLOADS_DIR and rejects traversal or sibling roots", () => {
    expect(resolveDownloadPathInsideRoot("/data/downloads/show/episode.mkv", "/data/downloads"))
      .toBe("/data/downloads/show/episode.mkv");
    expect(resolveDownloadPathInsideRoot("/data/downloads/../library/episode.mkv", "/data/downloads"))
      .toBeNull();
    expect(resolveDownloadPathInsideRoot("/data/downloads-old/episode.mkv", "/data/downloads"))
      .toBeNull();
  });
});
