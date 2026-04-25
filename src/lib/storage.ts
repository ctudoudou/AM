import fs from "node:fs/promises";
import { getAppSettings } from "@/lib/settings";

export async function getStorageSummary() {
  const settings = await getAppSettings();
  const stats = await fs.statfs(settings.directories.dataRoot).catch((error: unknown) => {
    if (isMissingPathError(error)) {
      return null;
    }
    throw error;
  });

  if (!stats) {
    return {
      root: settings.directories.dataRoot,
      available: false,
      totalBytes: 0n,
      freeBytes: 0n,
      usedBytes: 0n,
      usedPercent: 0,
    };
  }

  const totalBytes = BigInt(stats.blocks) * BigInt(stats.bsize);
  const freeBytes = BigInt(stats.bavail) * BigInt(stats.bsize);
  const usedBytes = totalBytes - freeBytes;
  const usedPercent =
    totalBytes > 0n ? Math.round((Number(usedBytes) / Number(totalBytes)) * 100) : 0;

  return {
    root: settings.directories.dataRoot,
    available: true,
    totalBytes,
    freeBytes,
    usedBytes,
    usedPercent,
  };
}

function isMissingPathError(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
