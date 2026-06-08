import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { refreshMediaMetadata } from "@/lib/metadata";
import { upsertTitleAliases } from "@/lib/title-display";

vi.mock("@/lib/db", () => ({
  prisma: {
    mediaTitle: {
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
  },
}));

vi.mock("@/lib/metadata", () => ({
  refreshMediaMetadata: vi.fn(),
}));

vi.mock("@/lib/title-display", () => ({
  upsertTitleAliases: vi.fn(),
}));

describe("/api/library/media/[id]/repair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(upsertTitleAliases).mockResolvedValue({ created: 1 });
    vi.mocked(refreshMediaMetadata).mockResolvedValue({
      id: "media-1",
      title: "The King's Warden",
      updated: true,
      queries: ["The Man Who Lives with The King"],
      provider: "tmdb_movie",
      posterUrl: "/api/media-assets/covers/media-1-poster.jpeg",
    });
  });

  it("adds a manual alias before refreshing metadata", async () => {
    const response = await POST(
      new Request("http://localhost/api/library/media/media-1/repair", {
        method: "POST",
        body: JSON.stringify({
          action: "addAliasAndRefresh",
          alias: " The Man Who Lives with The King ",
        }),
      }),
      { params: Promise.resolve({ id: "media-1" }) },
    );

    await expect(response.json()).resolves.toMatchObject({
      updated: true,
      aliasCreated: 1,
      metadata: {
        provider: "tmdb_movie",
      },
    });
    expect(upsertTitleAliases).toHaveBeenCalledWith("media-1", [
      { title: "The Man Who Lives with The King" },
    ]);
    expect(refreshMediaMetadata).toHaveBeenCalledWith("media-1");
  });
});
