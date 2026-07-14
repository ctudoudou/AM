import { describe, expect, it } from "vitest";
import { collectDirtySettingsSections } from "./settings-dirty";

describe("settings dirty sections", () => {
  it("reports only changed settings groups", () => {
    const saved = { directories: { root: "/data" }, ai: { model: "old" }, general: { locale: "en" } };
    const current = { ...saved, ai: { model: "new" } };
    expect([...collectDirtySettingsSections(current, saved, ["directories", "ai", "general"])]).toEqual(["ai"]);
  });

  it("keeps secret-only groups dirty even when redacted settings are unchanged", () => {
    const settings = { aria2: { rpcUrl: "http://aria2" }, ai: { model: "model" } };
    expect([...collectDirtySettingsSections(settings, settings, ["aria2", "ai"], ["aria2"])]).toEqual([
      "aria2",
    ]);
  });
});
