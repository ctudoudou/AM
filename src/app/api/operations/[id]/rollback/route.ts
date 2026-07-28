import { z } from "zod";
import { assertTrustedMutationOrigin, jsonError, jsonResponse } from "@/lib/api";
import {
  OperationRollbackValidationError,
  rollbackOperation,
} from "@/lib/operation-log";

const rollbackSchema = z.object({
  confirmation: z.string().trim().min(1).max(128),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertTrustedMutationOrigin(request);
    const [{ id }, input] = await Promise.all([
      context.params,
      request.json().then((body) => rollbackSchema.parse(body)),
    ]);
    return jsonResponse(
      await rollbackOperation({ operationId: id, confirmation: input.confirmation }),
    );
  } catch (error) {
    if (error instanceof OperationRollbackValidationError) {
      return jsonResponse(
        { error: "INVALID_OPERATION_ROLLBACK", message: error.message },
        { status: 400 },
      );
    }
    return jsonError(error);
  }
}
