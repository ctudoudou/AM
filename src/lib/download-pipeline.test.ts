import { describe, expect, it } from "vitest";
import { buildDownloadPipeline } from "./download-pipeline";

describe("download pipeline", () => {
  it("keeps organizer and library waiting while a download is active", () => {
    expect(buildDownloadPipeline({ status: "ACTIVE" })).toEqual({
      download: "active",
      organizer: "waiting",
      library: "waiting",
      blockedReason: null,
    });
  });

  it("marks review plans as a visible organizer block", () => {
    expect(
      buildDownloadPipeline({
        status: "COMPLETED",
        organizerPlans: [{ status: "NEEDS_REVIEW", reason: "Low confidence" }],
      }),
    ).toMatchObject({
      download: "done",
      organizer: "blocked",
      library: "waiting",
      blockedReason: "Low confidence",
    });
  });

  it("marks executed organizer plans as archived", () => {
    expect(
      buildDownloadPipeline({
        status: "COMPLETED",
        organizerPlans: [{ status: "EXECUTED" }],
      }),
    ).toMatchObject({ organizer: "done", library: "done", blockedReason: null });
  });
});
