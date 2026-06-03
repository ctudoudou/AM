import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { syncSeasonCatalogFromProvider } from "@/lib/season-catalog-sync";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json(await syncSeasonCatalogFromProvider(id, await request.json()));
  } catch (error) {
    return jsonError(error);
  }
}
