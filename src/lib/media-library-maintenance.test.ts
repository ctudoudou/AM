import { beforeEach, describe, expect, it, vi } from "vitest";
import { repairMediaLibrary } from "./media-library-maintenance";
import { mergeDuplicateMediaTitles, normalizeMediaPrimaryTitles } from "@/lib/media-title-repair";
import { refreshMediaLibraryMetadata } from "@/lib/metadata";

vi.mock("@/lib/media-title-repair", () => ({
  mergeDuplicateMediaTitles: vi.fn(),
  normalizeMediaPrimaryTitles: vi.fn(),
}));
vi.mock("@/lib/metadata", () => ({ refreshMediaLibraryMetadata: vi.fn() }));

describe("repairMediaLibrary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(normalizeMediaPrimaryTitles).mockResolvedValue({
      inspected: 2,
      updated: 2,
      results: [],
    });
    vi.mocked(mergeDuplicateMediaTitles).mockResolvedValue({
      inspected: 2,
      clusters: 1,
      merged: 1,
      results: [],
    });
    vi.mocked(refreshMediaLibraryMetadata).mockResolvedValue({
      checked: 1,
      updated: 1,
      results: [],
    });
  });

  it("normalizes, merges, and then fills missing metadata", async () => {
    const result = await repairMediaLibrary("TV");

    expect(result.mediaType).toBe("TV");
    expect(normalizeMediaPrimaryTitles).toHaveBeenCalledWith("TV");
    expect(mergeDuplicateMediaTitles).toHaveBeenCalledWith("TV");
    expect(refreshMediaLibraryMetadata).toHaveBeenCalledWith({ mediaType: "TV", onlyMissing: true });
    expect(vi.mocked(normalizeMediaPrimaryTitles).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(mergeDuplicateMediaTitles).mock.invocationCallOrder[0],
    );
    expect(vi.mocked(mergeDuplicateMediaTitles).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(refreshMediaLibraryMetadata).mock.invocationCallOrder[0],
    );
  });
});
