import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonError } from "./api";

describe("jsonError", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("keeps unexpected error details available outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const response = jsonError(new Error("database connection refused"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "INTERNAL_ERROR",
      message: "database connection refused",
    });
  });

  it("redacts unexpected error details from production responses", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new Error("postgres://user:secret@nas.internal/kura");

    const response = jsonError(error);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "INTERNAL_ERROR",
      message: "An unexpected server error occurred.",
    });
    expect(consoleError).toHaveBeenCalledWith("Unhandled API error", error);
  });

  it("returns 404 for Prisma missing-record errors without leaking details in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const error = new Prisma.PrismaClientKnownRequestError("Record with secret id was not found", {
      code: "P2025",
      clientVersion: "test",
    });

    const response = jsonError(error);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "NOT_FOUND",
      message: "Requested resource was not found.",
    });
  });

  it("returns 404 for missing filesystem resources", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const error = Object.assign(new Error("ENOENT: /private/media/file.mkv"), {
      code: "ENOENT",
    });

    const response = jsonError(error);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "NOT_FOUND",
      message: "Requested resource was not found.",
    });
  });

  it("returns 403 for paths outside configured roots", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = jsonError(
      new Error("Path is outside configured Kura roots: /etc/passwd"),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "PATH_OUTSIDE_ALLOWED_ROOT",
      message: "Requested path is outside the allowed roots.",
    });
  });
});
