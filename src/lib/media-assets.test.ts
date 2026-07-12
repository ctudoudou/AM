import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const metadataDir = "/tmp/kura-media-assets-test";

vi.mock("@/lib/settings", () => ({
  getAppSettings: vi.fn(async () => ({ directories: { metadataDir } })),
}));

import { localMediaAssetExists } from "./media-assets";

describe("localMediaAssetExists", () => {
  beforeAll(async () => {
    await fs.mkdir(path.join(metadataDir, "covers"), { recursive: true });
    await fs.writeFile(path.join(metadataDir, "covers", "poster.jpeg"), "image");
  });

  afterAll(async () => {
    await fs.rm(metadataDir, { recursive: true, force: true });
  });

  it("distinguishes present, missing, and remote artwork", async () => {
    await expect(localMediaAssetExists("/api/media-assets/covers/poster.jpeg")).resolves.toBe(true);
    await expect(localMediaAssetExists("/api/media-assets/covers/missing.jpeg")).resolves.toBe(false);
    await expect(localMediaAssetExists("/api/media-assets/../outside.jpeg")).resolves.toBe(false);
    await expect(localMediaAssetExists("https://example.test/poster.jpeg")).resolves.toBe(false);
  });
});
