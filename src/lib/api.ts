import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class UntrustedMutationOriginError extends Error {}

export function assertTrustedMutationOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) {
    return;
  }
  const expectedOrigin = new URL(request.url).origin;
  if (origin !== expectedOrigin) {
    throw new UntrustedMutationOriginError("Cross-origin mutation requests are not allowed.");
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

  const message = error instanceof Error ? error.message : "Unexpected error";
  return NextResponse.json(
    {
      error: "INTERNAL_ERROR",
      message,
    },
    { status: 500 },
  );
}
