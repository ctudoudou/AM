import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OPERATION_ROLLBACK_CONFIRMATION,
  OperationRollbackValidationError,
  rollbackOperation,
} from "@/lib/operation-log";
import { POST } from "./route";

vi.mock("@/lib/operation-log", () => ({
  OPERATION_ROLLBACK_CONFIRMATION: "I understand this resumes the audited aria2 task",
  OperationRollbackValidationError: class extends Error {},
  rollbackOperation: vi.fn(),
}));

describe("/api/operations/[id]/rollback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rollbackOperation).mockResolvedValue({
      operationId: "operation-1",
      rollbackOperationId: "rollback-1",
      gid: "gid-1",
    });
  });

  it("rolls back an explicitly confirmed operation", async () => {
    const response = await POST(
      new Request("http://localhost/api/operations/operation-1/rollback", {
        method: "POST",
        body: JSON.stringify({ confirmation: OPERATION_ROLLBACK_CONFIRMATION }),
      }),
      { params: Promise.resolve({ id: "operation-1" }) },
    );

    expect(response.status).toBe(200);
    expect(rollbackOperation).toHaveBeenCalledWith({
      operationId: "operation-1",
      confirmation: OPERATION_ROLLBACK_CONFIRMATION,
    });
  });

  it("returns a validation error for a non-rollbackable operation", async () => {
    vi.mocked(rollbackOperation).mockRejectedValue(
      new OperationRollbackValidationError("not rollbackable"),
    );

    const response = await POST(
      new Request("http://localhost/api/operations/operation-1/rollback", {
        method: "POST",
        body: JSON.stringify({ confirmation: OPERATION_ROLLBACK_CONFIRMATION }),
      }),
      { params: Promise.resolve({ id: "operation-1" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "INVALID_OPERATION_ROLLBACK",
    });
  });

  it("rejects cross-origin rollback requests", async () => {
    const response = await POST(
      new Request("http://localhost/api/operations/operation-1/rollback", {
        method: "POST",
        headers: { Origin: "https://malicious.example" },
        body: JSON.stringify({ confirmation: OPERATION_ROLLBACK_CONFIRMATION }),
      }),
      { params: Promise.resolve({ id: "operation-1" }) },
    );

    expect(response.status).toBe(403);
    expect(rollbackOperation).not.toHaveBeenCalled();
  });
});
