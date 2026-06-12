import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defaultAppSettings } from "./settings";

vi.mock("@/lib/db", () => ({
  prisma: {},
}));

describe("anime season calendar", () => {
  let calendar: typeof import("./anime-season-calendar");

  beforeAll(async () => {
    calendar = await import("./anime-season-calendar");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it("reuses fresh cached provider results instead of fetching every visit", async () => {
    const metadataDir = await fs.mkdtemp(path.join(os.tmpdir(), "kura-calendar-"));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          pagination: { has_next_page: false },
          data: [
            {
              mal_id: 1,
              url: "https://myanimelist.net/anime/1",
              title: "Cached Anime",
              aired: { from: "2026-04-01T00:00:00+00:00" },
              broadcast: { day: "Wednesdays", time: "23:00", timezone: "Asia/Tokyo" },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const settings = {
      directories: {
        ...defaultAppSettings.directories,
        metadataDir,
      },
      general: {
        ...defaultAppSettings.general,
        animeCalendarRefreshMinutes: 60,
      },
    };

    const input = { provider: "jikan" as const, year: 2026, quarter: "Q2" as const };
    const now = new Date("2026-06-11T00:00:00.000Z");
    const first = await calendar.getAnimeSeasonCalendar(input, { settings, now });
    const second = await calendar.getAnimeSeasonCalendar(input, { settings, now });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.cache.hit).toBe(false);
    expect(second.cache.hit).toBe(true);
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.title).toBe("Cached Anime");
  });
});
