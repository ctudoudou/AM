import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {},
}));

describe("anime season calendar", () => {
  let calendar: typeof import("./anime-season-calendar");

  beforeAll(async () => {
    calendar = await import("./anime-season-calendar");
  });

  it("maps calendar months to anime quarters", () => {
    expect(calendar.quarterFromMonth(1)).toBe("Q1");
    expect(calendar.quarterFromMonth(4)).toBe("Q2");
    expect(calendar.quarterFromMonth(7)).toBe("Q3");
    expect(calendar.quarterFromMonth(10)).toBe("Q4");
  });

  it("derives the current anime quarter from a date", () => {
    expect(calendar.getCurrentAnimeCalendarQuarter(new Date("2026-06-11T00:00:00+08:00"))).toEqual({
      year: 2026,
      quarter: "Q2",
    });
  });
});
