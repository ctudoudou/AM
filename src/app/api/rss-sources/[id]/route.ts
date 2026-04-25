import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { jsonError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { rssSourceUpdateSchema } from "@/lib/rss-sources";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const input = rssSourceUpdateSchema.parse(await request.json());
    const source = await prisma.rssSource.update({
      where: { id },
      data: input,
    });
    return NextResponse.json(source);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return NextResponse.json(
        { error: "RSS_SOURCE_NOT_FOUND", message: "RSS source not found" },
        { status: 404 },
      );
    }
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    await prisma.rssSource.delete({
      where: { id },
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return NextResponse.json(
        { error: "RSS_SOURCE_NOT_FOUND", message: "RSS source not found" },
        { status: 404 },
      );
    }
    return jsonError(error);
  }
}
