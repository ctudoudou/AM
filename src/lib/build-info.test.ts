import { afterEach, describe, expect, it } from "vitest";
import {
  assertKuraBuildRevision,
  BuildRevisionMismatchError,
  getKuraBuildRevision,
} from "./build-info";

describe("Kura build revision", () => {
  const originalRevision = process.env.KURA_BUILD_SHA;

  afterEach(() => {
    if (originalRevision === undefined) {
      delete process.env.KURA_BUILD_SHA;
    } else {
      process.env.KURA_BUILD_SHA = originalRevision;
    }
  });

  it("uses a stable development revision when no build SHA is injected", () => {
    delete process.env.KURA_BUILD_SHA;
    expect(getKuraBuildRevision()).toBe("development");
    expect(assertKuraBuildRevision("development")).toBe("development");
  });

  it("rejects a client built from another revision", () => {
    process.env.KURA_BUILD_SHA = "server-sha";
    expect(() => assertKuraBuildRevision("client-sha")).toThrow(
      BuildRevisionMismatchError,
    );
  });
});
