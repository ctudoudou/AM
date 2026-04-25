import fs from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parseNewRssItems } from "@/lib/rss-fetcher";
import { groupUngroupedCandidates } from "@/lib/candidate-grouper";
import { getAppSettings } from "@/lib/settings";

export async function createManualMagnetIntake(input: {
  title?: string;
  magnetUrl: string;
}) {
  const title = input.title?.trim() || input.magnetUrl;
  const item = await prisma.rssItem.create({
    data: {
      origin: "manual",
      title,
      link: input.magnetUrl,
      magnetUrl: input.magnetUrl,
      raw: input as Prisma.InputJsonValue,
    },
  });

  await parseNewRssItems(10);
  await groupUngroupedCandidates(10);
  return item;
}

export async function createManualTorrentIntake(input: {
  title: string;
  fileName: string;
  bytes: ArrayBuffer;
}) {
  const settings = await getAppSettings();
  const torrentDir = assertInsideRoot(
    path.join(settings.directories.metadataDir, "torrents"),
    settings.directories.dataRoot,
  );
  await fs.mkdir(torrentDir, { recursive: true });
  const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const torrentFilePath = assertInsideRoot(
    path.join(torrentDir, `${Date.now()}-${safeName}`),
    settings.directories.dataRoot,
  );
  await fs.writeFile(torrentFilePath, Buffer.from(input.bytes));

  const item = await prisma.rssItem.create({
    data: {
      origin: "manual",
      title: input.title || input.fileName,
      torrentFilePath,
      raw: {
        title: input.title,
        fileName: input.fileName,
        torrentFilePath,
      },
    },
  });

  await parseNewRssItems(10);
  await groupUngroupedCandidates(10);
  return item;
}

function assertInsideRoot(candidatePath: string, rootPath: string) {
  const resolved = path.resolve(candidatePath);
  const root = path.resolve(rootPath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Path is outside configured Kura root: ${candidatePath}`);
  }
  return resolved;
}
