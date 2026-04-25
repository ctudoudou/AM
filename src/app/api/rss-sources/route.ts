import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { jsonError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { rssSourceCreateSchema } from "@/lib/rss-sources";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sources = await prisma.rssSource.findMany({
      orderBy: [{ enabled: "desc" }, { name: "asc" }],
    });
    return NextResponse.json({ sources });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = rssSourceCreateSchema.parse(await request.json());
    const source = await prisma.rssSource.create({
      data: input,
    });
    return NextResponse.json(source, { status: 201 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "RSS_SOURCE_EXISTS", message: "RSS source URL already exists" },
        { status: 409 },
      );
    }
    return jsonError(error);
  }
}
