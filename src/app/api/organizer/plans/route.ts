import { jsonError, jsonResponse } from "@/lib/api";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const plans = await prisma.organizerPlan.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        items: true,
        candidate: { include: { group: true } },
        download: true,
        mediaTitle: true,
      },
    });
    return jsonResponse({ plans });
  } catch (error) {
    return jsonError(error);
  }
}
