import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { getPublicAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getPublicAppSettings());
  } catch (error) {
    return jsonError(error);
  }
}
