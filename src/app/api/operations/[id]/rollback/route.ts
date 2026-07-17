import { z } from "zod";
import { assertTrustedMutationOrigin, jsonError, jsonResponse } from "@/lib/api";
import {
  OPERATION_ROLLBACK_CONFIRMATION,
  OperationRollbackValidationError,
  rollbackOperation,
} from "@/lib/operation-log";

const rollbackSchema = z.object({
  confirmation: z.literal(OPERATION_ROLLBACK_CONFIRMATION),
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
