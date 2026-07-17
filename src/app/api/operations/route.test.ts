import { beforeEach, describe, expect, it, vi } from "vitest";
import { listOperationLogs } from "@/lib/operation-log";
import { GET } from "./route";

vi.mock("@/lib/operation-log", () => ({
  listOperationLogs: vi.fn(),
}));

describe("/api/operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listOperationLogs).mockResolvedValue([]);
  });

  it("returns filtered recent operation logs", async () => {
    const response = await GET(
      new Request("http://localhost/api/operations?domain=DOWNLOAD&status=FAILED&limit=10"),
    );

    expect(response.status).toBe(200);
    expect(listOperationLogs).toHaveBeenCalledWith({
      domain: "DOWNLOAD",
      status: "FAILED",
      limit: 10,
    });
  });

  it("rejects unsupported domains", async () => {
    const response = await GET(
      new Request("http://localhost/api/operations?domain=UNKNOWN"),
    );

    expect(response.status).toBe(400);
    expect(listOperationLogs).not.toHaveBeenCalled();
  });
});
