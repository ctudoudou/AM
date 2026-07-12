import { jsonError, jsonResponse } from "@/lib/api";
import { aria2Request } from "@/lib/aria2";
import { prisma } from "@/lib/db";
import { buildDownloadDiagnostics } from "@/lib/downloads";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const includeSuperseded =
      new URL(request.url).searchParams.get("includeSuperseded") === "true";
    const downloads = await prisma.download.findMany({
      where: includeSuperseded ? undefined : { supersededById: null },
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
    const aria2 = await aria2Request<{
      downloadSpeed: string;
      uploadSpeed: string;
      numActive: string;
      numWaiting: string;
      numStopped: string;
      numStoppedTotal: string;
    }>("getGlobalStat").catch((error) => ({
      error: error instanceof Error ? error.message : "Unable to read aria2 status",
    }));
    return jsonResponse({
      downloads: downloads.map((download) => ({
        ...download,
        aria2Diagnostics: buildDownloadDiagnostics(download),
      })),
      aria2,
    });
  } catch (error) {
    return jsonError(error);
  }
}
