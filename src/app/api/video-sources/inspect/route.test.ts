import { beforeEach, describe, expect, it, vi } from "vitest";
import { inspectVideoSource, UnsupportedVideoSourceError } from "@/lib/video-sources/registry";
import { POST } from "./route";

vi.mock("@/lib/video-sources/registry", () => ({
  UnsupportedVideoSourceError: class extends Error {},
  VideoSourcePlanStaleError: class extends Error {},
  inspectVideoSource: vi.fn(),
}));

vi.mock("@/lib/video-sources/imports", () => ({
  VideoSourceImportValidationError: class extends Error {},
}));

describe("/api/video-sources/inspect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(inspectVideoSource).mockResolvedValue({
      planId: "a".repeat(64),
      provider: "agedm",
      providerName: "AGE动漫",
      sourceItemId: "20250111",
      sourceUrl: "https://www.agedm.io/detail/20250111",
      canonicalUrl: "https://www.agedm.io/detail/20250111",
      kind: "detail",
      title: "测试动画",
      description: null,
      posterUrl: null,
      seasonNumber: 1,
      episodes: [],
    });
  });

  it("inspects a supported source URL", async () => {
    const response = await POST(
      new Request("http://localhost/api/video-sources/inspect", {
        method: "POST",
        body: JSON.stringify({ url: "https://www.agedm.io/detail/20250111" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(inspectVideoSource).toHaveBeenCalledWith(
      "https://www.agedm.io/detail/20250111",
    );
  });

  it("returns a bounded error for unsupported providers", async () => {
    vi.mocked(inspectVideoSource).mockRejectedValue(
      new UnsupportedVideoSourceError("not supported"),
    );
    const response = await POST(
      new Request("http://localhost/api/video-sources/inspect", {
        method: "POST",
        body: JSON.stringify({ url: "https://example.com/video" }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "UNSUPPORTED_VIDEO_SOURCE",
    });
  });

  it("rejects cross-origin inspection requests", async () => {
    const response = await POST(
      new Request("http://localhost/api/video-sources/inspect", {
        method: "POST",
        headers: { Origin: "https://malicious.example" },
        body: JSON.stringify({ url: "https://www.agedm.io/detail/20250111" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(inspectVideoSource).not.toHaveBeenCalled();
  });
});
