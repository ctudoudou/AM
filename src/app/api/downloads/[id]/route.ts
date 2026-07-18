import { z } from "zod";
import { assertTrustedMutationOrigin, jsonError, jsonResponse } from "@/lib/api";
import { controlAria2Download } from "@/lib/downloads";
import { retryVideoSourceImportIfPresent } from "@/lib/video-sources/imports";

export const dynamic = "force-dynamic";

const actionSchema = z.object({
  action: z.enum(["pause", "resume", "remove", "sync", "retry"]),
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    assertTrustedMutationOrigin(request);
    const { id } = await context.params;
    const { action } = actionSchema.parse(await request.json());
    if (action === "retry") {
      const retried = await retryVideoSourceImportIfPresent(id);
      if (retried) {
        return jsonResponse(retried);
      }
    }
    return jsonResponse(await controlAria2Download(id, action));
  } catch (error) {
    return jsonError(error);
  }
}
