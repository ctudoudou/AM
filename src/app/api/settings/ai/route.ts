import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { redactAppSettings, updateAiSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  try {
    const settings = await updateAiSettings(await request.json());
    return NextResponse.json(redactAppSettings(settings));
  } catch (error) {
    return jsonError(error);
  }
}
