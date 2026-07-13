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
      expect.objectContaining({ skip: 100, take: 50 }),
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
          status: { in: ["PENDING", "NEEDS_REVIEW", "CONFLICT", "FAILED"] },
          items: { some: {} },
        }),
      }),
    );
  });

  it("hides resolved rejected plans unless audit history is explicitly requested", async () => {
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
