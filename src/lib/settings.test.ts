import { describe, expect, it } from "vitest";
import {
  defaultAppSettings,
  directorySettingsSchema,
  redactAppSettings,
} from "./settings";

describe("directorySettingsSchema", () => {
  it("accepts directories inside DATA_ROOT", () => {
    expect(
      directorySettingsSchema.parse({
        dataRoot: "/data",
        downloadsDir: "/data/downloads",
        stagingDir: "/data/staging",
        animeLibraryDir: "/data/library/anime",
        moviesLibraryDir: "/data/library/movies",
        tvLibraryDir: "/data/library/tv",
        metadataDir: "/data/metadata",
        transcodesDir: "/data/transcodes",
      }),
    ).toMatchObject({
      dataRoot: "/data",
      animeLibraryDir: "/data/library/anime",
    });
  });

  it("rejects configured directories outside DATA_ROOT", () => {
    expect(() =>
      directorySettingsSchema.parse({
        dataRoot: "/data",
        downloadsDir: "/tmp/downloads",
        stagingDir: "/data/staging",
        animeLibraryDir: "/data/library/anime",
        moviesLibraryDir: "/data/library/movies",
        tvLibraryDir: "/data/library/tv",
        metadataDir: "/data/metadata",
        transcodesDir: "/data/transcodes",
      }),
    ).toThrow("Directory must be inside DATA_ROOT");
  });
});

describe("redactAppSettings", () => {
  it("does not expose stored secrets", () => {
    const publicSettings = redactAppSettings({
      ...defaultAppSettings,
      aria2: {
        ...defaultAppSettings.aria2,
        rpcSecret: "secret",
      },
      ai: {
        ...defaultAppSettings.ai,
        openRouterApiKey: "key",
      },
    });

    expect(publicSettings.aria2).toEqual({
      rpcUrl: defaultAppSettings.aria2.rpcUrl,
      rpcSecretConfigured: true,
    });
    expect(publicSettings.ai.openRouterApiKeyConfigured).toBe(true);
    expect(JSON.stringify(publicSettings)).not.toContain("secret");
    expect(JSON.stringify(publicSettings)).not.toContain("key");
  });
});
