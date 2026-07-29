import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertTrustedMutationOrigin,
  jsonError,
  UntrustedMutationOriginError,
} from "./api";

describe("assertTrustedMutationOrigin", () => {
  it("accepts a direct same-origin mutation", () => {
    const request = new Request("http://192.168.8.7:3023/api/organizer/plans/plan/execute", {
      method: "POST",
      headers: {
        Host: "192.168.8.7:3023",
        Origin: "http://192.168.8.7:3023",
      },
    });

    expect(() => assertTrustedMutationOrigin(request)).not.toThrow();
  });

  it("accepts the public Host when Next.js sees an internal container URL", () => {
    const request = new Request("http://0.0.0.0:3000/api/organizer/plans/plan/execute", {
      method: "POST",
      headers: {
        Host: "192.168.8.7:3023",
        Origin: "http://192.168.8.7:3023",
      },
    });

    expect(() => assertTrustedMutationOrigin(request)).not.toThrow();
  });

  it("accepts a same-origin mutation forwarded through a TLS proxy", () => {
    const request = new Request("http://kura-web:3000/api/organizer/plans/plan/execute", {
      method: "POST",
      headers: {
        Host: "kura-web:3000",
        Origin: "https://kura.example",
        "X-Forwarded-Host": "kura.example",
        "X-Forwarded-Proto": "https",
      },
    });

    expect(() => assertTrustedMutationOrigin(request)).not.toThrow();
  });

  it("continues to reject a cross-origin mutation", () => {
    const request = new Request("http://kura-web:3000/api/organizer/plans/plan/execute", {
      method: "POST",
      headers: {
        Host: "192.168.8.7:3023",
        Origin: "https://malicious.example",
        "X-Forwarded-Host": "192.168.8.7:3023",
        "X-Forwarded-Proto": "http",
      },
    });

    expect(() => assertTrustedMutationOrigin(request)).toThrow(
      UntrustedMutationOriginError,
    );
  });
});

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

  it("returns an actionable 503 when the database schema is behind", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new Prisma.PrismaClientKnownRequestError(
      "The column OrganizerPlan.resolvedAt does not exist",
      {
        code: "P2022",
        clientVersion: "test",
        meta: { column: "OrganizerPlan.resolvedAt" },
      },
    );

    const response = jsonError(error);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "DATABASE_MIGRATION_REQUIRED",
      message:
        "Kura's database schema is older than this application build. Run the matching migrator before retrying.",
    });
    expect(consoleError).toHaveBeenCalledWith("Database migration required", error);
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
