import { beforeEach, describe, expect, it, vi } from "vitest";
import { aria2Request } from "@/lib/aria2";
import { prisma } from "@/lib/db";
import { GET } from "./route";

vi.mock("@/lib/db", () => ({
  prisma: {
    download: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("@/lib/aria2", () => ({
  aria2Request: vi.fn(),
}));

vi.mock("@/lib/downloads", () => ({
  buildDownloadDiagnostics: vi.fn(() => ({ reason: "none" })),
}));

describe("/api/downloads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.download.findMany).mockResolvedValue([]);
    vi.mocked(prisma.download.count).mockResolvedValue(0);
    vi.mocked(aria2Request).mockResolvedValue({
      downloadSpeed: "0",
      uploadSpeed: "0",
      numActive: "0",
      numWaiting: "0",
      numStopped: "0",
      numStoppedTotal: "0",
    });
  });

  it("hides superseded repair records from the default downloads list", async () => {
    const response = await GET(new Request("http://localhost/api/downloads"));

    expect(response.status).toBe(200);
    expect(prisma.download.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { supersededById: null },
        skip: 0,
        take: 25,
      }),
    );
  });

  it("paginates and filters downloads on the server", async () => {
    vi.mocked(prisma.download.count).mockResolvedValue(80);

    const response = await GET(
      new Request("http://localhost/api/downloads?status=FAILED&page=2&pageSize=20"),
    );
    const body = await response.json();

    expect(prisma.download.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { supersededById: null, status: "FAILED" },
        skip: 20,
        take: 20,
      }),
    );
    expect(body.pagination).toEqual({
      page: 2,
      pageSize: 20,
      total: 80,
      totalPages: 4,
      hasNext: true,
      hasPrevious: true,
    });
  });

  it("returns a compact list projection and strips bulky aria2 file metadata", async () => {
    vi.mocked(prisma.download.findMany).mockResolvedValue([
      {
        id: "download-1",
        status: "ACTIVE",
        progress: 0.5,
        aria2Files: [
          { path: "[METADATA]example", length: "0", uris: [{ uri: "magnet:?large" }] },
          { path: "/downloads/episode-1.mkv", length: "100", completedLength: "50", uris: [{ uri: "https://tracker.example" }] },
          { path: "/downloads/episode-2.mkv", length: "200", completedLength: "20", uris: [{ uri: "https://tracker.example" }] },
          { path: "/downloads/episode-3.mkv", length: "300", completedLength: "0", uris: [{ uri: "https://tracker.example" }] },
          { path: "/downloads/episode-4.mkv", length: "400", completedLength: "0", uris: [{ uri: "https://tracker.example" }] },
        ],
        candidate: null,
        organizerPlans: [],
      },
    ] as never);

    const response = await GET(new Request("http://localhost/api/downloads"));
    const body = await response.json();

    expect(prisma.download.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          id: true,
          aria2Files: true,
          candidate: expect.any(Object),
          organizerPlans: expect.any(Object),
        }),
      }),
    );
    expect(prisma.download.findMany.mock.calls[0]?.[0]).not.toHaveProperty("include");
    expect(body.downloads[0].aria2Files).toEqual([
      { path: "/downloads/episode-1.mkv", length: "100", completedLength: "50" },
      { path: "/downloads/episode-2.mkv", length: "200", completedLength: "20" },
      { path: "/downloads/episode-3.mkv", length: "300", completedLength: "0" },
    ]);
    expect(JSON.stringify(body.downloads[0])).not.toContain("tracker.example");
  });

  it("caps page size and ignores unknown statuses", async () => {
    await GET(
      new Request("http://localhost/api/downloads?status=UNKNOWN&page=invalid&pageSize=1000"),
    );

    expect(prisma.download.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { supersededById: null },
        skip: 0,
        take: 100,
      }),
    );
  });

  it("can include superseded records for audit tooling", async () => {
    const response = await GET(
      new Request("http://localhost/api/downloads?includeSuperseded=true"),
    );

    expect(response.status).toBe(200);
    expect(prisma.download.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined }),
    );
  });
});
