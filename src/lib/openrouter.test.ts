import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAppSettings } from "@/lib/settings";
import {
  groupCandidatesWithOpenRouter,
  reviewOrganizerPlanWithOpenRouter,
  translateSubtitleCuesWithOpenRouter,
} from "./openrouter";

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

describe("groupCandidatesWithOpenRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAppSettings).mockResolvedValue({
      ai: { openRouterApiKey: "", model: "" },
    } as Awaited<ReturnType<typeof getAppSettings>>);
  });

  it("marks high-confidence heuristic fallback groups for review", async () => {
    const groups = await groupCandidatesWithOpenRouter([
      {
        id: "candidate-1",
        rawTitle: "[Group] Example - 01 [1080p]",
        parsedTitle: "Example",
        normalizedTitle: "example",
        episodeNumber: 1,
        season: 1,
        resolution: "1080p",
      },
    ]);

    expect(groups[0]).toMatchObject({
      confidence: 0.85,
      reviewRequired: true,
    });
  });
});

describe("reviewOrganizerPlanWithOpenRouter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates a movie classification and requires every path to be classified", async () => {
    vi.mocked(getAppSettings).mockResolvedValue({
      ai: { openRouterApiKey: "test-key", model: "test/model" },
    } as Awaited<ReturnType<typeof getAppSettings>>);
    const sourcePath = "/data/downloads/Example Movie (2026).mkv";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                riskLevel: "OK",
                confidence: 0.96,
                summary: "The file is the requested movie.",
                acceptedSourcePaths: [sourcePath],
                rejectedSourcePaths: [],
              }),
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      reviewOrganizerPlanWithOpenRouter({
        planId: "plan-1",
        mediaType: "MOVIE",
        candidateTitle: "Example Movie",
        candidateAliases: ["Example Movie"],
        season: 1,
        episodeNumber: 1,
        targetTitle: "Example Movie",
        items: [
          {
            sourcePath,
            targetPath: "/data/library/movies/Example Movie (2026)/Example Movie (2026).mkv",
          },
        ],
      }),
    ).resolves.toMatchObject({
      riskLevel: "OK",
      confidence: 0.96,
      acceptedSourcePaths: [sourcePath],
    });
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.messages[0].content).toContain("anime, movies, and TV series");
    expect(requestBody.messages[0].content).toContain("Classify every provided path exactly once");
  });
});
