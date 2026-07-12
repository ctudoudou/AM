import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { repairMediaLibrary } from "@/lib/media-library-maintenance";
import { refreshMediaLibraryMetadata } from "@/lib/metadata";

vi.mock("@/lib/media-library-maintenance", () => ({ repairMediaLibrary: vi.fn() }));
vi.mock("@/lib/metadata", () => ({ refreshMediaLibraryMetadata: vi.fn() }));

describe("/api/library/maintenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs the TV repair pipeline", async () => {
    vi.mocked(repairMediaLibrary).mockResolvedValue({
      mediaType: "TV",
      normalized: { inspected: 2, updated: 2, results: [] },
      merged: { inspected: 2, clusters: 1, merged: 1, results: [] },
      metadata: { checked: 1, updated: 1, results: [] },
    });
    const response = await POST(new Request("http://localhost/api/library/maintenance", {
      method: "POST",
      body: JSON.stringify({ action: "repair", mediaType: "TV" }),
    }));

    expect(response.status).toBe(200);
    expect(repairMediaLibrary).toHaveBeenCalledWith("TV");
  });

  it("refreshes missing movie metadata without running a merge", async () => {
    vi.mocked(refreshMediaLibraryMetadata).mockResolvedValue({ checked: 1, updated: 0, results: [] });
    const response = await POST(new Request("http://localhost/api/library/maintenance", {
      method: "POST",
      body: JSON.stringify({ action: "refreshMetadata", mediaType: "MOVIE" }),
    }));

    expect(response.status).toBe(200);
    expect(refreshMediaLibraryMetadata).toHaveBeenCalledWith({ mediaType: "MOVIE", onlyMissing: true });
    expect(repairMediaLibrary).not.toHaveBeenCalled();
  });
});
