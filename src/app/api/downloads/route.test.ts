import { beforeEach, describe, expect, it, vi } from "vitest";
import { aria2Request } from "@/lib/aria2";
import { prisma } from "@/lib/db";
import { GET } from "./route";

vi.mock("@/lib/db", () => ({
  prisma: {
    download: {
      findMany: vi.fn(),
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
      expect.objectContaining({ where: { supersededById: null } }),
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
