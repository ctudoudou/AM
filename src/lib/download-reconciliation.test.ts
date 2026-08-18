import { describe, expect, it } from "vitest";
import {
  buildDownloadReconciliationPlan,
  type DownloadReconciliationRecord,
  type DownloadReconciliationSnapshot,
  type LibraryTargetEvidence,
} from "./download-reconciliation";

function download(
  overrides: Partial<DownloadReconciliationRecord> = {},
): DownloadReconciliationRecord {
  return {
    id: "download-1",
    aria2Gid: "gid-1",
    infoHash: "a".repeat(40),
    status: "COMPLETED",
    sourceUrl: `magnet:?xt=urn:btih:${"a".repeat(40)}`,
    targetPath: "/data/downloads/show/episode.mkv",
    title: "Show 01",
    archiveStatus: "archived",
    supersededById: null,
    stalledSince: null,
    organizerPlans: [
      {
        id: "plan-1",
        status: "EXECUTED",
        items: [
          {
            sourcePath: "/data/downloads/show/episode.mkv",
            targetPath: "/data/library/anime/Show/Season 01/Show - S01E01.mkv",
            sizeBytes: BigInt(100),
          },
        ],
      },
    ],
    ...overrides,
  };
}

function targetEvidence(
  state: LibraryTargetEvidence["state"] = "complete",
): Map<string, LibraryTargetEvidence> {
  return new Map([
    [
      "/data/library/anime/Show/Season 01/Show - S01E01.mkv\u0000100",
      {
        path: "/data/library/anime/Show/Season 01/Show - S01E01.mkv",
        expectedBytes: "100",
        actualBytes: state === "complete" ? "100" : "80",
        state,
      },
    ],
  ]);
}

function plan(overrides: Partial<DownloadReconciliationSnapshot> = {}) {
  return buildDownloadReconciliationPlan({
    downloads: [download()],
    knownAria2: [
      {
        gid: "gid-1",
        status: "active",
        infoHash: "a".repeat(40),
        completedLength: "10",
        totalLength: "100",
        files: [
          {
            path: "/data/downloads/show/episode.mkv",
            length: "100",
            completedLength: "10",
          },
        ],
      },
    ],
    targetEvidence: targetEvidence(),
    ...overrides,
  });
}

describe("download reconciliation planning", () => {
  it("marks archived active downloads as safe pause candidates only with exact library evidence", () => {
    const result = plan();

    expect(result.summary).toMatchObject({
      archivedActive: 1,
      safePause: 1,
      trackedAria2: 1,
      untrackedAria2: 0,
    });
    expect(result.items[0]).toMatchObject({
      kind: "archived_active",
      downloadId: "download-1",
      matchedBy: "gid",
      recommendedAction: "pause",
      safeToPause: true,
      executable: false,
    });
  });

  it("keeps archived redownloads in review when library bytes do not match", () => {
    const result = plan({ targetEvidence: targetEvidence("mismatch") });

    expect(result.summary.safePause).toBe(0);
    expect(result.items[0]).toMatchObject({
      kind: "archived_active",
      recommendedAction: "review",
      safeToPause: false,
    });
  });

  it("keeps pause actions review-only when the library root is unavailable", () => {
    const result = plan({
      targetEvidence: targetEvidence("root_unavailable"),
      warnings: ["Configured library root is unavailable."],
    });

    expect(result.warnings).toEqual(["Configured library root is unavailable."]);
    expect(result.items[0]).toMatchObject({
      kind: "archived_active",
      recommendedAction: "review",
      safeToPause: false,
    });
  });

  it("recognizes prefixed metadata helper paths as untracked metadata", () => {
    const result = plan({
      knownAria2: [
        {
          gid: "metadata-gid",
          status: "complete",
          infoHash: "b".repeat(40),
          followedBy: ["payload-gid"],
          totalLength: "0",
          files: [{ path: `[METADATA]${"b".repeat(40)}`, length: "0" }],
        },
      ],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      kind: "untracked_metadata",
      gid: "metadata-gid",
      payloadFileCount: 0,
      matchedBy: "none",
    });
  });

  it("infers an archived redownload from its info hash without adopting the GID", () => {
    const result = plan({
      knownAria2: [
        {
          gid: "replacement-gid",
          status: "active",
          infoHash: "a".repeat(40),
          completedLength: "10",
          totalLength: "100",
          files: [{ path: "/data/downloads/recreated.mkv", length: "100" }],
        },
      ],
    });

    expect(result.summary).toMatchObject({ untrackedAria2: 1, archivedActive: 1 });
    expect(result.items[0]).toMatchObject({
      kind: "archived_active",
      matchedBy: "info_hash",
      downloadId: "download-1",
      recommendedAction: "pause",
      executable: false,
    });
  });

  it("requires review when an untracked GID matches multiple canonical downloads", () => {
    const result = plan({
      downloads: [
        download(),
        download({
          id: "download-2",
          aria2Gid: "gid-2",
          targetPath: "/data/downloads/show/duplicate.mkv",
        }),
      ],
      knownAria2: [
        {
          gid: "replacement-gid",
          status: "active",
          infoHash: "a".repeat(40),
          totalLength: "100",
          files: [{ path: "/data/downloads/recreated.mkv", length: "100" }],
        },
      ],
    });

    expect(result.items[0]).toMatchObject({
      kind: "ambiguous_match",
      candidateDownloadIds: ["download-1", "download-2"],
      recommendedAction: "review",
      safeToPause: false,
    });
  });

  it("does not report normally tracked non-archived downloads as anomalies", () => {
    const result = plan({
      downloads: [download({ status: "ACTIVE", archiveStatus: null, organizerPlans: [] })],
    });

    expect(result.summary.anomalies).toBe(0);
    expect(result.items).toEqual([]);
  });

  it("reports a tracked payload that has been stalled beyond the blocked threshold", () => {
    const result = plan({
      downloads: [
        download({
          status: "ACTIVE",
          archiveStatus: null,
          organizerPlans: [],
          stalledSince: new Date("2026-01-01T00:00:00.000Z"),
        }),
      ],
    });

    expect(result.summary).toMatchObject({
      anomalies: 1,
      stalledTracked: 1,
      manualReview: 1,
    });
    expect(result.items[0]).toMatchObject({
      kind: "stalled_tracked",
      downloadId: "download-1",
      recommendedAction: "review",
      safeToPause: false,
    });
  });

  it("does not report a recently stalled tracked payload", () => {
    const result = plan({
      downloads: [
        download({
          status: "ACTIVE",
          archiveStatus: null,
          organizerPlans: [],
          stalledSince: new Date(Date.now() - 2 * 3_600_000),
        }),
      ],
    });

    expect(result.summary.stalledTracked).toBe(0);
    expect(result.items).toEqual([]);
  });
});
