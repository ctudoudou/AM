import { describe, expect, it } from "vitest";
import {
  buildOrganizerRepairPlan,
  type OrganizerRepairGroup,
} from "./organizer-repair";

function group(overrides: Partial<OrganizerRepairGroup> = {}): OrganizerRepairGroup {
  return {
    key: "download:download-1",
    planIds: ["plan-1"],
    statuses: ["REJECTED"],
    downloadId: "download-1",
    downloadStatus: "COMPLETED",
    archiveStatus: "organizer_failed",
    supersededById: null,
    sourceUrlAvailable: true,
    title: "Example",
    episode: 1,
    hasItems: true,
    sourcePaths: [{ path: "/data/downloads/example.mkv", exists: false }],
    targetPaths: [{ path: "/data/library/anime/Example/Season 01/example.mkv", exists: false }],
    archivedEvidencePaths: [],
    hasBlockingPlan: false,
    ...overrides,
  };
}

describe("organizer repair planning", () => {
  it("removes unlinked history only when its source is gone", () => {
    const result = buildOrganizerRepairPlan([
      group({ downloadId: null, downloadStatus: null, sourceUrlAvailable: false }),
    ]);
    expect(result.items[0]).toMatchObject({ kind: "delete_stale", executable: true });
  });

  it("resolves a completed download when archived media exists under another title", () => {
    const result = buildOrganizerRepairPlan([
      group({ archivedEvidencePaths: ["/data/library/anime/Alias/Season 01/episode.mkv"] }),
    ]);
    expect(result.items[0]).toMatchObject({ kind: "resolve_archived", confidence: "high" });
  });

  it("resolves an orphaned empty review only with archived-file evidence", () => {
    const result = buildOrganizerRepairPlan([
      group({
        statuses: ["NEEDS_REVIEW"],
        hasItems: false,
        sourcePaths: [{ path: "/data/downloads/example.mkv", exists: true }],
        archivedEvidencePaths: ["/data/library/anime/Example/Season 01/example.mkv"],
      }),
    ]);
    expect(result.items[0]).toMatchObject({ kind: "resolve_archived", executable: true });
  });

  it("does not regenerate an orphaned empty review without archived-file evidence", () => {
    const result = buildOrganizerRepairPlan([
      group({
        statuses: ["NEEDS_REVIEW"],
        hasItems: false,
        sourcePaths: [{ path: "/data/downloads/example.mkv", exists: true }],
      }),
    ]);
    expect(result.items[0]).toMatchObject({ kind: "manual_review", executable: false });
  });

  it("regenerates only when a source exists and no plan blocks it", () => {
    const result = buildOrganizerRepairPlan([
      group({ sourcePaths: [{ path: "/data/downloads/example.mkv", exists: true }] }),
    ]);
    expect(result.items[0]).toMatchObject({ kind: "regenerate", executable: true });
  });

  it("waits for active downloads", () => {
    const result = buildOrganizerRepairPlan([group({ downloadStatus: "ACTIVE" })]);
    expect(result.items[0]).toMatchObject({ kind: "wait_download", executable: false });
  });

  it("retries one linked download when both source and archive are missing", () => {
    const result = buildOrganizerRepairPlan([group()]);
    expect(result.items[0]).toMatchObject({ kind: "retry_missing", executable: true });
  });

  it("keeps a stable plan ID for the same evidence", () => {
    expect(buildOrganizerRepairPlan([group()]).planId).toBe(buildOrganizerRepairPlan([group()]).planId);
  });
});
