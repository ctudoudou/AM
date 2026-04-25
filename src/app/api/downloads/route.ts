import { jsonError, jsonResponse } from "@/lib/api";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const downloads = await prisma.download.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        candidate: {
          include: {
            group: true,
          },
        },
        organizerPlans: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { items: true },
        },
      },
    });
    return jsonResponse({ downloads });
  } catch (error) {
    return jsonError(error);
  }
}
