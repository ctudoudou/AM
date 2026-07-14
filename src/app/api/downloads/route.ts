import type { DownloadStatus, Prisma } from "@prisma/client";
import { jsonError, jsonResponse } from "@/lib/api";
import { aria2Request } from "@/lib/aria2";
import { prisma } from "@/lib/db";
import { buildDownloadDiagnostics } from "@/lib/downloads";

export const dynamic = "force-dynamic";

const downloadStatuses = new Set<DownloadStatus>([
  "WAITING",
  "ACTIVE",
  "PAUSED",
  "COMPLETED",
  "FAILED",
]);

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const includeSuperseded = searchParams.get("includeSuperseded") === "true";
    const requestedStatus = searchParams.get("status");
    const status = isDownloadStatus(requestedStatus) ? requestedStatus : undefined;
    const page = positiveInteger(searchParams.get("page"), 1);
    const pageSize = Math.min(100, positiveInteger(searchParams.get("pageSize"), 25));
    const where = buildWhere(includeSuperseded, status);
    const [downloads, total, aria2] = await Promise.all([
      prisma.download.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
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
      }),
      prisma.download.count({ where }),
      aria2Request<{
        downloadSpeed: string;
        uploadSpeed: string;
        numActive: string;
        numWaiting: string;
        numStopped: string;
        numStoppedTotal: string;
      }>("getGlobalStat").catch((error) => ({
        error: error instanceof Error ? error.message : "Unable to read aria2 status",
      })),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return jsonResponse({
      downloads: downloads.map((download) => ({
        ...download,
        aria2Diagnostics: buildDownloadDiagnostics(download),
      })),
      aria2,
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrevious: page > 1,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

function isDownloadStatus(value: string | null): value is DownloadStatus {
  return Boolean(value && downloadStatuses.has(value as DownloadStatus));
}

function positiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function buildWhere(
  includeSuperseded: boolean,
  status: DownloadStatus | undefined,
): Prisma.DownloadWhereInput | undefined {
  if (includeSuperseded && !status) {
    return undefined;
  }
  return {
    ...(includeSuperseded ? {} : { supersededById: null }),
    ...(status ? { status } : {}),
  };
}
