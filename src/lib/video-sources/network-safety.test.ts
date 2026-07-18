import { describe, expect, it, vi } from "vitest";
import {
  assertPublicHttpUrl,
  fetchPublicHtml,
  isBlockedAddress,
  VideoSourceNetworkError,
} from "./network-safety";

describe("video source network safety", () => {
  it("allows public HTTP hosts and rejects private or credentialed destinations", async () => {
    const publicLookup = vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    await expect(assertPublicHttpUrl("https://example.com/video", publicLookup)).resolves.toEqual(
      new URL("https://example.com/video"),
    );
    await expect(
      assertPublicHttpUrl("https://example.com/video", async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "192.168.8.7", family: 4 },
      ]),
    ).rejects.toBeInstanceOf(VideoSourceNetworkError);
    await expect(
      assertPublicHttpUrl("https://user:secret@example.com/video", publicLookup),
    ).rejects.toBeInstanceOf(VideoSourceNetworkError);
  });

  it("blocks loopback, private, link-local, CGNAT, and unique-local addresses", () => {
    expect(isBlockedAddress("127.0.0.1")).toBe(true);
    expect(isBlockedAddress("10.0.0.1")).toBe(true);
    expect(isBlockedAddress("100.64.0.1")).toBe(true);
    expect(isBlockedAddress("169.254.1.1")).toBe(true);
    expect(isBlockedAddress("172.31.0.1")).toBe(true);
    expect(isBlockedAddress("192.168.8.7")).toBe(true);
    expect(isBlockedAddress("::1")).toBe(true);
    expect(isBlockedAddress("fd00::1")).toBe(true);
    expect(isBlockedAddress("2606:4700:4700::1111")).toBe(false);
  });

  it("revalidates redirects before following them", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/admin" },
      }),
    );
    await expect(
      fetchPublicHtml("https://example.com/detail/1", {
        fetchImpl,
        lookupAll: async (hostname) => [
          {
            address: hostname === "example.com" ? "93.184.216.34" : "127.0.0.1",
            family: 4,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(VideoSourceNetworkError);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("bounds inspected HTML size", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("x".repeat(32), {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    await expect(
      fetchPublicHtml("https://example.com/detail/1", {
        fetchImpl,
        lookupAll: async () => [{ address: "93.184.216.34", family: 4 }],
        maxBytes: 16,
      }),
    ).rejects.toThrow("allowed inspection size");
  });
});
