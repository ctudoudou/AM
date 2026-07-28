import { describe, expect, it } from "vitest";
import { createOrganizerPlanVersion } from "./organizer-plan-version";

function planVersionInput() {
  return {
    id: "plan-1",
    status: "PENDING",
    confidence: 0.85,
    autoExecutable: false,
    reason: "Ready for confirmation",
    updatedAt: new Date("2026-07-28T00:00:00.000Z"),
    items: [
      {
        id: "item-1",
        sourcePath: "/data/downloads/01.mkv",
        targetPath: "/data/library/anime/Series/Season 01/Series - S01E01.mkv",
        fileType: "video",
        conflict: false,
        conflictReason: null,
      },
    ],
  };
}

describe("organizer plan version", () => {
  it("is stable for the same reviewed plan snapshot", () => {
    expect(createOrganizerPlanVersion(planVersionInput())).toBe(
      createOrganizerPlanVersion(planVersionInput()),
    );
  });

  it("changes when a reviewed path changes", () => {
    const changed = planVersionInput();
    changed.items[0].targetPath =
      "/data/library/anime/Other/Season 01/Other - S01E01.mkv";
    expect(createOrganizerPlanVersion(changed)).not.toBe(
      createOrganizerPlanVersion(planVersionInput()),
    );
  });
});
