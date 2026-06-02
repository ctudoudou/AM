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
        importRoot: "/data/import",
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
      importRoot: "/data/import",
      animeLibraryDir: "/data/library/anime",
    });
  });

  it("rejects configured directories outside DATA_ROOT", () => {
    expect(() =>
      directorySettingsSchema.parse({
        dataRoot: "/data",
        importRoot: "/data/import",
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
      metadataProviders: {
        ...defaultAppSettings.metadataProviders,
        theTvdbApiKey: "tvdb-secret",
        anidbUsername: "anidb-user",
        anidbPassword: "anidb-password",
        anidbClientName: "kura",
      },
    });

    expect(publicSettings.aria2).toEqual({
      rpcUrl: defaultAppSettings.aria2.rpcUrl,
      rpcSecretConfigured: true,
    });
    expect(publicSettings.ai.openRouterApiKeyConfigured).toBe(true);
    expect(publicSettings.metadataProviders).toMatchObject({
      theTvdbApiKeyConfigured: true,
      anidbUsernameConfigured: true,
      anidbPasswordConfigured: true,
      anidbClientName: "kura",
    });
    expect(JSON.stringify(publicSettings)).not.toContain("secret");
    expect(JSON.stringify(publicSettings)).not.toContain("key");
    expect(JSON.stringify(publicSettings)).not.toContain("anidb-user");
    expect(JSON.stringify(publicSettings)).not.toContain("anidb-password");
  });
});
