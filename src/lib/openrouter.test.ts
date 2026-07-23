import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAppSettings } from "@/lib/settings";
import { translateSubtitleCuesWithOpenRouter } from "./openrouter";

vi.mock("@/lib/settings", () => ({
  getAppSettings: vi.fn(),
}));

describe("translateSubtitleCuesWithOpenRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAppSettings).mockResolvedValue({
      ai: {
        provider: "openrouter",
        openRouterApiKey: "test-key",
        model: "test/model",
      },
    } as Awaited<ReturnType<typeof getAppSettings>>);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries a transient provider failure and validates the cue response", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  cues: [{ index: 7, text: "你好，世界" }],
                }),
              },
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      translateSubtitleCuesWithOpenRouter({
        targetLanguage: "zh-Hans",
        cues: [{ index: 7, text: "Hello, world" }],
      }),
    ).resolves.toEqual([{ index: 7, text: "你好，世界" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not call the provider when OpenRouter is not configured", async () => {
    vi.mocked(getAppSettings).mockResolvedValue({
      ai: {
        provider: "openrouter",
        openRouterApiKey: "",
        model: "test/model",
      },
    } as Awaited<ReturnType<typeof getAppSettings>>);
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      translateSubtitleCuesWithOpenRouter({
        targetLanguage: "zh-Hant",
        cues: [{ index: 0, text: "Hello" }],
      }),
    ).rejects.toThrow("API key is not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
