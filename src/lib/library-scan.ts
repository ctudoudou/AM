import fs from "node:fs/promises";
import path from "node:path";
import type { MediaType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";

const videoExtensions = new Set([".mkv", ".mp4", ".avi", ".mov", ".webm", ".m4v", ".ts"]);

type ScanTarget = {
  type: MediaType;
  root: string;
};

export async function scanLibraryRoots() {
  const settings = await getAppSettings();
  const targets: ScanTarget[] = [
    { type: "ANIME", root: settings.directories.animeLibraryDir },
    { type: "MOVIE", root: settings.directories.moviesLibraryDir },
    { type: "TV", root: settings.directories.tvLibraryDir },
  ];
  const results = [];

  for (const target of targets) {
    const files = await findVideoFiles(target.root).catch(() => []);
    let created = 0;
    let updated = 0;
    for (const filePath of files) {
      const result = await upsertScannedVideo(filePath, target, settings.directories.dataRoot);
      created += result.created ? 1 : 0;
      updated += result.created ? 0 : 1;
    }
    results.push({ type: target.type, root: target.root, scanned: files.length, created, updated });
  }

  return { results };
}

async function upsertScannedVideo(
  filePath: string,
  target: ScanTarget,
  dataRoot: string,
) {
  const stat = await fs.stat(filePath);
  const parsed = parseLibraryIdentity(filePath, target);
  const media = await findOrCreateMediaTitle(target.type, parsed.title, parsed.year);
  const season = await prisma.season.upsert({
    where: { mediaId_number: { mediaId: media.id, number: parsed.season } },
    create: { mediaId: media.id, number: parsed.season },
    update: {},
  });
  const episode = await prisma.episode.upsert({
    where: { seasonId_number: { seasonId: season.id, number: parsed.episode } },
    create: { seasonId: season.id, number: parsed.episode, title: parsed.episodeTitle },
    update: { title: parsed.episodeTitle },
  });
  const existing = await prisma.mediaFile.findFirst({
    where: { absolutePath: filePath },
    select: { id: true },
  });
  const data = {
    episodeId: episode.id,
    relativePath: path.relative(dataRoot, filePath),
    absolutePath: filePath,
    originalName: path.basename(filePath),
    sizeBytes: BigInt(stat.size),
  };

  if (existing) {
    await prisma.mediaFile.update({
      where: { id: existing.id },
      data,
    });
    return { created: false };
  }

  await prisma.mediaFile.create({ data });
  return { created: true };
}

async function findOrCreateMediaTitle(type: MediaType, title: string, year?: number) {
  const existing = await prisma.mediaTitle.findFirst({
    where: { type, primaryTitle: title, year: year ?? null },
  });
  if (existing) {
    return existing;
  }
  return prisma.mediaTitle.create({
    data: {
      type,
      primaryTitle: title,
      year,
    },
  });
}

async function findVideoFiles(root: string): Promise<string[]> {
  const stat = await fs.stat(root);
  if (stat.isFile()) {
    return videoExtensions.has(path.extname(root).toLowerCase()) ? [path.resolve(root)] : [];
  }
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findVideoFiles(fullPath)));
    } else if (videoExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(path.resolve(fullPath));
    }
  }
  return files;
}

function parseLibraryIdentity(filePath: string, target: ScanTarget) {
  const baseName = path.basename(filePath, path.extname(filePath));
  const parentName = path.basename(path.dirname(filePath));
  const titleSource = target.type === "MOVIE" ? parentName || baseName : inferSeriesName(filePath);
  const title = cleanTitle(titleSource || baseName);
  const year = extractYear(titleSource) ?? extractYear(baseName);
  const tvMatch =
    baseName.match(/\bS(?<season>\d{1,2})E(?<episode>\d{1,4})\b/i) ??
    baseName.match(/\bE(?<episode>\d{1,4})\b/i);
  const seasonFromDir = parentName.match(/season\s*(?<season>\d{1,2})/i)?.groups?.season;
  const episodeFromLoose = baseName.match(/(?:第|\s|\[| - )(?<episode>\d{1,4})(?:话|集|\]|\s|$)/i)
    ?.groups?.episode;

  if (target.type === "MOVIE") {
    return {
      title,
      year,
      season: 1,
      episode: 1,
      episodeTitle: title,
    };
  }

  return {
    title,
    year,
    season: Number(tvMatch?.groups?.season ?? seasonFromDir ?? 1),
    episode: Number(tvMatch?.groups?.episode ?? episodeFromLoose ?? 1),
    episodeTitle: cleanTitle(baseName),
  };
}

function inferSeriesName(filePath: string) {
  const parent = path.basename(path.dirname(filePath));
  if (/season\s*\d+/i.test(parent)) {
    return path.basename(path.dirname(path.dirname(filePath)));
  }
  return parent;
}

function extractYear(value: string) {
  const year = Number(value.match(/[\[(](?<year>19\d{2}|20\d{2})[\])]/)?.groups?.year);
  return Number.isFinite(year) ? year : undefined;
}

function cleanTitle(value: string) {
  return value
    .replace(/[\[(](19\d{2}|20\d{2})[\])]/g, " ")
    .replace(/\bS\d{1,2}E\d{1,4}\b/gi, " ")
    .replace(/\bE\d{1,4}\b/gi, " ")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "Unknown";
}
