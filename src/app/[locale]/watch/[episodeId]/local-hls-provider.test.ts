import type { HLSLibrary, MediaProviderAdapter } from "@vidstack/react";
import { describe, expect, it } from "vitest";
import {
  configureLocalHlsProvider,
  loadLocalHls,
} from "./local-hls-provider";

describe("configureLocalHlsProvider", () => {
  it("replaces the remote HLS library with the bundled loader", async () => {
    const provider = {
      $$PROVIDER_TYPE: "HLS",
      library: "https://cdn.example.invalid/hls.js",
    } as unknown as MediaProviderAdapter;

    expect(configureLocalHlsProvider(provider)).toBe(true);
    expect((provider as unknown as { library: HLSLibrary }).library).toBe(loadLocalHls);

    const importedHls = await loadLocalHls();
    expect(typeof importedHls.default).toBe("function");
  });

  it("leaves non-HLS providers unchanged", () => {
    const provider = {
      $$PROVIDER_TYPE: "VIDEO",
    } as unknown as MediaProviderAdapter;

    expect(configureLocalHlsProvider(provider)).toBe(false);
    expect(provider).not.toHaveProperty("library");
  });
});
