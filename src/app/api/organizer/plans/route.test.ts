import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const { organizerPlan } = vi.hoisted(() => ({
  organizerPlan: {
    findMany: vi.fn(),
    groupBy: vi.fn(),
    count: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: { organizerPlan } }));
vi.mock("@/lib/organizer", () => ({
  assessOrganizerPlanAutomation: vi.fn(() => ({
    executable: false,
    autoExecutable: false,
    reasons: [],
  })),
}));

describe("/api/organizer/plans", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    organizerPlan.findMany.mockResolvedValue([]);
    organizerPlan.groupBy.mockResolvedValue([
      { status: "EXECUTED", _count: { _all: 319 } },
      { status: "REJECTED", _count: { _all: 115 } },
    ]);
  });

  it("paginates the complete all-plans view", async () => {
    organizerPlan.count
      .mockResolvedValueOnce(459)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(459);

    const response = await GET(
      new Request("http://localhost/api/organizer/plans?view=all&page=3&pageSize=50"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(organizerPlan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 100,
        take: 50,
        where: expect.not.objectContaining({ resolvedAt: null }),
      }),
    );
    expect(body.page).toEqual({
      page: 3,
      pageSize: 50,
      total: 459,
      totalPages: 10,
      hasNext: true,
      hasPrevious: true,
    });
  });

  it("selects only fields required by the organizer list and automation assessment", async () => {
    organizerPlan.count.mockResolvedValue(0);

    await GET(new Request("http://localhost/api/organizer/plans?page=1&pageSize=50"));

    expect(organizerPlan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          id: true,
          metadata: true,
          items: {
            select: expect.objectContaining({
              id: true,
              sourcePath: true,
              targetPath: true,
              fileType: true,
            }),
          },
          candidate: {
            select: expect.objectContaining({
              parsedTitle: true,
              normalizedTitle: true,
              group: {
                select: expect.objectContaining({
                  displayTitle: true,
                  normalizedTitle: true,
                  aliases: true,
                }),
              },
            }),
          },
        }),
      }),
    );
    expect(organizerPlan.findMany.mock.calls[0]?.[0]).not.toHaveProperty("include");
  });

  it("returns a compact organizer DTO without provider metadata or assessment-only fields", async () => {
    organizerPlan.findMany.mockResolvedValue([
      {
        id: "plan-1",
        mediaType: "ANIME",
        status: "PENDING",
        confidence: 0.95,
        reason: "ready",
        autoExecutable: true,
        updatedAt: new Date("2026-07-28T12:00:00.000Z"),
        metadata: {
          title: "Some Anime",
          posterUrl: "https://image.example/poster.jpg",
          year: 2026,
          synopsis: "large synopsis",
          raw: { providerPayload: "large payload" },
          aiReview: {
            riskLevel: "OK",
            confidence: 0.94,
            summary: "Title and episode match.",
            acceptedSourcePaths: ["/data/import/episode.mkv"],
            rejectedSourcePaths: [],
          },
        },
        candidate: {
          mediaType: "ANIME",
          parsedTitle: "Some Anime",
          normalizedTitle: "some anime",
          group: {
            displayTitle: "Some Anime",
            normalizedTitle: "some anime",
            aliases: ["assessment-only alias"],
          },
        },
        items: [
          {
            id: "item-1",
            sourcePath: "/data/import/episode.mkv",
            targetPath: "/data/anime/episode.mkv",
            fileType: "video",
            conflict: false,
            conflictReason: null,
          },
        ],
      },
    ]);
    organizerPlan.count.mockResolvedValue(1);
    organizerPlan.groupBy.mockResolvedValue([]);

    const response = await GET(
      new Request("http://localhost/api/organizer/plans?view=all&page=1&pageSize=25"),
    );
    const body = await response.json();

    expect(body.plans[0].metadata).toEqual({
      title: "Some Anime",
      posterUrl: "https://image.example/poster.jpg",
      year: 2026,
      aiReview: {
        riskLevel: "OK",
        confidence: 0.94,
        summary: "Title and episode match.",
        acceptedItems: 1,
        rejectedItems: 0,
        fileClassifications: [],
      },
    });
    expect(body.plans[0].candidate).toEqual({
      parsedTitle: "Some Anime",
      group: { displayTitle: "Some Anime" },
    });
    expect(body.plans[0].items[0]).toMatchObject({ fileType: "video" });
    expect(body.plans[0].version).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(body.plans[0])).not.toContain("providerPayload");
    expect(JSON.stringify(body.plans[0])).not.toContain("assessment-only alias");
  });

  it("keeps the active view scoped to plans with file items", async () => {
    organizerPlan.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(459);

    await GET(new Request("http://localhost/api/organizer/plans?page=1&pageSize=50"));

    expect(organizerPlan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["PENDING", "NEEDS_REVIEW", "EXECUTING", "CONFLICT", "FAILED"] },
          items: { some: {} },
        }),
      }),
    );
  });

  it("resolves a deep link to the exact organizer plan including history", async () => {
    organizerPlan.count.mockResolvedValue(0);

    await GET(
      new Request("http://localhost/api/organizer/plans?view=all&planId=plan-history"),
    );

    expect(organizerPlan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "plan-history" }),
      }),
    );
    expect(organizerPlan.findMany.mock.calls[0]?.[0]?.where).not.toHaveProperty(
      "resolvedAt",
    );
  });

  it("hides resolved plans unless audit history is explicitly requested", async () => {
    organizerPlan.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(459);

    await GET(
      new Request("http://localhost/api/organizer/plans?status=REJECTED&page=1&pageSize=50"),
    );

    expect(organizerPlan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ["REJECTED"] }, resolvedAt: null }),
      }),
    );

    vi.clearAllMocks();
    organizerPlan.findMany.mockResolvedValue([]);
    organizerPlan.groupBy.mockResolvedValue([]);
    organizerPlan.count.mockResolvedValue(0);
    await GET(
      new Request("http://localhost/api/organizer/plans?status=NEEDS_REVIEW&page=1&pageSize=50"),
    );
    expect(organizerPlan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["NEEDS_REVIEW"] },
          resolvedAt: null,
        }),
      }),
    );

    vi.clearAllMocks();
    organizerPlan.findMany.mockResolvedValue([]);
    organizerPlan.groupBy.mockResolvedValue([]);
    organizerPlan.count.mockResolvedValue(0);
    await GET(
      new Request(
        "http://localhost/api/organizer/plans?status=REJECTED&includeResolved=true&page=1&pageSize=50",
      ),
    );
    expect(organizerPlan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ resolvedAt: null }),
      }),
    );
  });
});
