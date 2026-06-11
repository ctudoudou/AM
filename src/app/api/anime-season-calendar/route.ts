import { z } from "zod";
import { jsonError, jsonResponse } from "@/lib/api";
import {
  animeCalendarProviders,
  animeCalendarQuarters,
  getAnimeSeasonCalendar,
  getCurrentAnimeCalendarQuarter,
} from "@/lib/anime-season-calendar";

const calendarQuerySchema = z.object({
  provider: z.enum(animeCalendarProviders).default("bangumi"),
  year: z.coerce.number().int().min(1970).max(2100).optional(),
  quarter: z.enum(animeCalendarQuarters).optional(),
});

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const current = getCurrentAnimeCalendarQuarter();
    const input = calendarQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const year = input.year ?? current.year;
    const quarter = input.quarter ?? current.quarter;
    const items = await getAnimeSeasonCalendar({
      provider: input.provider,
      year,
      quarter,
    });

    return jsonResponse({
      provider: input.provider,
      year,
      quarter,
      generatedAt: new Date().toISOString(),
      providerNotice:
        input.provider === "bangumi"
          ? "Bangumi calendar exposes the current airing table; use Jikan for historical or non-current quarters."
          : null,
      items,
    });
  } catch (error) {
    return jsonError(error);
  }
}
