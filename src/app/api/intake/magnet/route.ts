import { z } from "zod";
import { jsonError, jsonResponse } from "@/lib/api";
import { createManualMagnetIntake } from "@/lib/intake";

const magnetSchema = z.object({
  title: z.string().optional(),
  magnetUrl: z.string().startsWith("magnet:"),
  mediaType: z.enum(["ANIME", "MOVIE", "TV", "AUTO"]),
});

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = magnetSchema.parse(await request.json());
    return jsonResponse(await createManualMagnetIntake(input), { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
