import { z } from "zod";
import { jsonError, jsonResponse } from "@/lib/api";
import { controlAria2Download } from "@/lib/downloads";

export const dynamic = "force-dynamic";

const actionSchema = z.object({
  action: z.enum(["pause", "resume", "remove", "sync"]),
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { action } = actionSchema.parse(await request.json());
    return jsonResponse(await controlAria2Download(id, action));
  } catch (error) {
    return jsonError(error);
  }
}
