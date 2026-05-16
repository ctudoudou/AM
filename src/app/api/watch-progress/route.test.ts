import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH, POST } from "./route";
import { prisma } from "@/lib/db";

vi.mock("@/lib/db", () => ({
  prisma: {
    watchProgress: {
      upsert: vi.fn(),
    },
  },
}));

const upsertMock = vi.mocked(prisma.watchProgress.upsert);

describe("/api/watch-progress", () => {
  beforeEach(() => {
    upsertMock.mockReset();
    upsertMock.mockResolvedValue({
      id: "progress-1",
      episodeId: "episode-1",
      positionSec: 540,
      durationSec: 600,
      completed: true,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
  });

  it("updates progress from PATCH JSON", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/watch-progress", {
        method: "PATCH",
        body: JSON.stringify({
          episodeId: "episode-1",
          positionSec: 120,
          durationSec: 600,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { episodeId: "episode-1" },
        update: expect.objectContaining({
          positionSec: 120,
          durationSec: 600,
          completed: false,
        }),
      }),
    );
  });

  it("accepts POST JSON for beacon and keepalive flushes", async () => {
    const response = await POST(
      new Request("http://localhost/api/watch-progress", {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({
          episodeId: "episode-1",
          positionSec: 540,
          durationSec: 600,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ completed: true }),
        update: expect.objectContaining({ completed: true }),
      }),
    );
  });
});
