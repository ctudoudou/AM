import fs from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeTitleAliases } from "@/lib/anime-parser";
import { parseMediaReleaseTitle, type IntakeMediaType } from "@/lib/media-parser";
import { createOrganizerPlanForCandidateSource } from "@/lib/organizer";
import { getAppSettings } from "@/lib/settings";

const videoExtensions = new Set([".mkv", ".mp4", ".avi", ".mov", ".webm", ".m4v", ".ts"]);
const activePlanStatuses = ["PENDING", "NEEDS_REVIEW", "CONFLICT", "EXECUTED", "AUTO_ARCHIVED"] as const;

export type ImportScanInput = {
  root: string;
  mediaType: IntakeMediaType;
};

export function parseImportReleaseFromPath(filePath: string, mediaType: IntakeMediaType) {
  const baseName = path.basename(filePath, path.extname(filePath));
  return parseMediaReleaseTitle(baseName, mediaType);
}

export async function scanImportDirectory(input: ImportScanInput) {
  const settings = await getAppSettings();
  const root = assertImportRootInsideDataRoot(input.root, settings.directories.dataRoot);
  const files = await findVideoFiles(root);
  let planned = 0;
  let skipped = 0;
  let lowConfidence = 0;
  const plans: string[] = [];

  for (const filePath of files) {
    if (await hasActivePlanForSource(filePath)) {
      skipped += 1;
      continue;
    }

    const parsed = parseImportReleaseFromPath(filePath, input.mediaType);
    if (parsed.confidence < 0.7) {
      lowConfidence += 1;
    }
    const candidate = await createImportCandidate(filePath, parsed);
    const plan = await createOrganizerPlanForCandidateSource({
      candidateId: candidate.id,
      sourceRoot: filePath,
    });
    planned += 1;
    plans.push(plan.id);
  }

  return {
    root,
    scanned: files.length,
    planned,
    skipped,
    lowConfidence,
    plans,
  };
}

async function createImportCandidate(
  filePath: string,
  parsed: ReturnType<typeof parseMediaReleaseTitle>,
) {
  const season = parsed.season ?? 1;
  const group = await prisma.releaseCandidateGroup.upsert({
    where: {
      mediaType_normalizedTitle_season: {
        mediaType: parsed.mediaType,
        normalizedTitle: parsed.normalizedTitle,
        season,
      },
    },
    create: {
      mediaType: parsed.mediaType,
      normalizedTitle: parsed.normalizedTitle,
      displayTitle: parsed.parsedTitle,
      season,
      confidence: parsed.confidence,
      reviewRequired: parsed.confidence < 0.82,
      aiSummary: "Created from local import scan.",
      aliases: normalizeTitleAliases(parsed.parsedTitle) as Prisma.InputJsonValue,
    },
    update: {
      displayTitle: parsed.parsedTitle,
      confidence: Math.max(parsed.confidence, 0.65),
      aliases: normalizeTitleAliases(parsed.parsedTitle) as Prisma.InputJsonValue,
    },
  });
  const item = await prisma.rssItem.create({
    data: {
      origin: "import-scan",
      mediaType: parsed.mediaType,
      title: parsed.rawTitle,
      link: `file://${filePath}`,
      status: "GROUPED",
      raw: {
        filePath,
        originalName: path.basename(filePath),
      },
    },
  });

  return prisma.releaseCandidate.create({
    data: {
      group: { connect: { id: group.id } },
      rssItem: { connect: { id: item.id } },
      mediaType: parsed.mediaType,
      rawTitle: parsed.rawTitle,
      parsedTitle: parsed.parsedTitle,
      normalizedTitle: parsed.normalizedTitle,
      subtitleGroup: parsed.subtitleGroup,
      episodeNumber: parsed.episodeNumber,
      season,
      resolution: parsed.resolution,
      codec: parsed.codec,
      audio: parsed.audio,
      subtitleLanguage: parsed.subtitleLanguage,
      releaseProfile: parsed.releaseProfile,
      sourceKind: parsed.sourceKind,
      variantKey: parsed.variantKey,
      releaseTags: parsed.releaseTags,
      sourceUrl: `file://${filePath}`,
      confidence: parsed.confidence,
      status: parsed.confidence >= 0.7 ? "READY" : "REVIEW",
    },
  });
}

async function hasActivePlanForSource(sourcePath: string) {
  const existing = await prisma.organizerPlan.findFirst({
    where: {
      status: { in: [...activePlanStatuses] },
      items: { some: { sourcePath } },
    },
    select: { id: true },
  });
  return Boolean(existing);
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

export function assertImportRootInsideDataRoot(candidatePath: string, rootPath: string) {
  const resolved = path.resolve(candidatePath);
  const root = path.resolve(rootPath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Import path must be inside DATA_ROOT: ${candidatePath}`);
  }
  return resolved;
}
