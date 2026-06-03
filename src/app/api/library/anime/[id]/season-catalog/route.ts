import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { getSeasonCatalog, replaceSeasonCatalog } from "@/lib/season-catalog";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return NextResponse.json(await getSeasonCatalog(id));
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return NextResponse.json(await replaceSeasonCatalog(id, await request.json()));
  } catch (error) {
    return jsonError(error);
  }
}
