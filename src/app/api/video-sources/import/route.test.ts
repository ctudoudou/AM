import { beforeEach, describe, expect, it, vi } from "vitest";
import { queueVideoSourceImports } from "@/lib/video-sources/imports";
import { VideoSourcePlanStaleError } from "@/lib/video-sources/registry";
import { POST } from "./route";

vi.mock("@/lib/video-sources/imports", () => ({
  VideoSourceImportValidationError: class extends Error {},
  queueVideoSourceImports: vi.fn(),
}));

vi.mock("@/lib/video-sources/registry", () => ({
  UnsupportedVideoSourceError: class extends Error {},
  VideoSourcePlanStaleError: class extends Error {},
}));

describe("/api/video-sources/import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(queueVideoSourceImports).mockResolvedValue({
      planId: "a".repeat(64),
      requested: 1,
      queued: 1,
      skipped: 0,
      failed: 0,
      results: [],
    });
  });

  it("queues selected episodes from a current inspection plan", async () => {
    const input = {
      url: "https://www.agedm.io/detail/20250111",
      planId: "a".repeat(64),
      episodeKeys: ["episode:1"],
    };
    const response = await POST(
      new Request("http://localhost/api/video-sources/import", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    );

    expect(response.status).toBe(201);
    expect(queueVideoSourceImports).toHaveBeenCalledWith(input);
  });

  it("rejects stale source plans", async () => {
    vi.mocked(queueVideoSourceImports).mockRejectedValue(
      new VideoSourcePlanStaleError("stale"),
    );
    const response = await POST(
      new Request("http://localhost/api/video-sources/import", {
        method: "POST",
        body: JSON.stringify({
          url: "https://www.agedm.io/detail/20250111",
          planId: "a".repeat(64),
          episodeKeys: ["episode:1"],
        }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "VIDEO_SOURCE_PLAN_STALE" });
  });

  it("rejects cross-origin download creation", async () => {
    const response = await POST(
      new Request("http://localhost/api/video-sources/import", {
        method: "POST",
        headers: { Origin: "https://malicious.example" },
        body: JSON.stringify({
          url: "https://www.agedm.io/detail/20250111",
          planId: "a".repeat(64),
          episodeKeys: ["episode:1"],
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(queueVideoSourceImports).not.toHaveBeenCalled();
  });
});
