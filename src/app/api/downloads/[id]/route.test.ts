import { beforeEach, describe, expect, it, vi } from "vitest";
import { controlAria2Download } from "@/lib/downloads";
import { retryVideoSourceImportIfPresent } from "@/lib/video-sources/imports";
import { PATCH } from "./route";

vi.mock("@/lib/downloads", () => ({
  controlAria2Download: vi.fn(),
}));

vi.mock("@/lib/video-sources/imports", () => ({
  retryVideoSourceImportIfPresent: vi.fn(),
}));

describe("/api/downloads/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(controlAria2Download).mockResolvedValue({ id: "download-1" } as never);
    vi.mocked(retryVideoSourceImportIfPresent).mockResolvedValue(null);
  });

  it("routes failed video source retries through fresh media resolution", async () => {
    vi.mocked(retryVideoSourceImportIfPresent).mockResolvedValue({
      id: "download-1",
      status: "WAITING",
    } as never);
    const response = await PATCH(
      new Request("http://localhost/api/downloads/download-1", {
        method: "PATCH",
        body: JSON.stringify({ action: "retry" }),
      }),
      { params: Promise.resolve({ id: "download-1" }) },
    );

    expect(response.status).toBe(200);
    expect(retryVideoSourceImportIfPresent).toHaveBeenCalledWith("download-1");
    expect(controlAria2Download).not.toHaveBeenCalled();
  });

  it("keeps normal aria2 retry behavior for non-plugin downloads", async () => {
    await PATCH(
      new Request("http://localhost/api/downloads/download-1", {
        method: "PATCH",
        body: JSON.stringify({ action: "retry" }),
      }),
      { params: Promise.resolve({ id: "download-1" }) },
    );

    expect(controlAria2Download).toHaveBeenCalledWith("download-1", "retry");
  });

  it("rejects cross-origin download mutations before retry lookup", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/downloads/download-1", {
        method: "PATCH",
        headers: { Origin: "https://malicious.example" },
        body: JSON.stringify({ action: "retry" }),
      }),
      { params: Promise.resolve({ id: "download-1" }) },
    );

    expect(response.status).toBe(403);
    expect(retryVideoSourceImportIfPresent).not.toHaveBeenCalled();
  });
});
