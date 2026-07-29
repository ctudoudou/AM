import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

export class UntrustedMutationOriginError extends Error {}

export function assertTrustedMutationOrigin(request: Request) {
  const originHeader = request.headers.get("origin");
  if (!originHeader) {
    return;
  }
  const origin = normalizeHttpOrigin(originHeader);
  if (!origin || !trustedRequestOrigins(request).has(origin)) {
    throw new UntrustedMutationOriginError("Cross-origin mutation requests are not allowed.");
  }
}

function trustedRequestOrigins(request: Request) {
  const requestUrl = new URL(request.url);
  const origins = new Set([requestUrl.origin]);
  const forwardedProtocol =
    normalizeForwardedProtocol(firstForwardedValue(request.headers.get("x-forwarded-proto"))) ??
    requestUrl.protocol;
  const host = firstForwardedValue(request.headers.get("host"));
  const forwardedHost = firstForwardedValue(request.headers.get("x-forwarded-host"));

  for (const authority of [host, forwardedHost]) {
    const origin = originFromAuthority(forwardedProtocol, authority);
    if (origin) {
      origins.add(origin);
    }
  }
  return origins;
}

function firstForwardedValue(value: string | null) {
  return value?.split(",", 1)[0]?.trim() || null;
}

function normalizeForwardedProtocol(value: string | null) {
  const protocol = value?.toLowerCase().replace(/:$/, "");
  return protocol === "http" || protocol === "https" ? `${protocol}:` : null;
}

function originFromAuthority(protocol: string, authority: string | null) {
  if (!authority || !["http:", "https:"].includes(protocol)) {
    return null;
  }
  try {
    return new URL(`${protocol}//${authority}`).origin;
  } catch {
    return null;
  }
}

function normalizeHttpOrigin(value: string) {
  try {
    const origin = new URL(value);
    return ["http:", "https:"].includes(origin.protocol) ? origin.origin : null;
  } catch {
    return null;
  }
}

export function jsonResponse(data: unknown, init?: ResponseInit) {
  return new NextResponse(
    JSON.stringify(data, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
    {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    },
  );
}

export function jsonError(error: unknown) {
  if (error instanceof UntrustedMutationOriginError) {
    return NextResponse.json(
      { error: "UNTRUSTED_ORIGIN", message: error.message },
      { status: 403 },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: "VALIDATION_ERROR",
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  if (isDatabaseMigrationError(error)) {
    if (process.env.NODE_ENV === "production") {
      console.error("Database migration required", error);
    }
    return NextResponse.json(
      {
        error: "DATABASE_MIGRATION_REQUIRED",
        message:
          "Kura's database schema is older than this application build. Run the matching migrator before retrying.",
      },
      { status: 503 },
    );
  }

  if (isNotFoundError(error)) {
    return NextResponse.json(
      {
        error: "NOT_FOUND",
        message: errorMessage(error, "Requested resource was not found."),
      },
      { status: 404 },
    );
  }

  if (isPathBoundaryError(error)) {
    return NextResponse.json(
      {
        error: "PATH_OUTSIDE_ALLOWED_ROOT",
        message: errorMessage(error, "Requested path is outside the allowed roots."),
      },
      { status: 403 },
    );
  }

  if (process.env.NODE_ENV === "production") {
    console.error("Unhandled API error", error);
  }
  return NextResponse.json(
    {
      error: "INTERNAL_ERROR",
      message: errorMessage(error, "An unexpected server error occurred."),
    },
    { status: 500 },
  );
}

function isDatabaseMigrationError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2021" || error.code === "P2022")
  );
}

function isNotFoundError(error: unknown) {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2025"
  ) {
    return true;
  }

  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function isPathBoundaryError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    /\bpath is outside configured\b/i.test(error.message) ||
    /\bpath must be inside data_root\b/i.test(error.message) ||
    /\bdirectory must (?:stay|be) inside\b/i.test(error.message)
  );
}

function errorMessage(error: unknown, productionMessage: string) {
  if (process.env.NODE_ENV === "production") {
    return productionMessage;
  }
  return error instanceof Error ? error.message : productionMessage;
}
