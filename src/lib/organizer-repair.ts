import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { DownloadStatus, MediaType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { retryFailedDownload } from "@/lib/downloads";
import { findExistingMediaTitle } from "@/lib/media-title-repair";
import { parseMediaReleaseTitle } from "@/lib/media-parser";
import { regenerateRejectedOrganizerPlan } from "@/lib/organizer";
import { getAppSettings } from "@/lib/settings";

export const ORGANIZER_REPAIR_CONFIRMATION = "I understand this repairs organizer records";

export class OrganizerRepairPlanStaleError extends Error {}
export class OrganizerRepairValidationError extends Error {}

export type OrganizerRepairKind =
  | "delete_stale"
  | "resolve_archived"
  | "regenerate"
  | "retry_missing"
  | "wait_download"
  | "manual_review";

export type OrganizerRepairGroup = {
  key: string;
  planIds: string[];
  statuses: string[];
  downloadId: string | null;
  downloadStatus: DownloadStatus | null;
  archiveStatus: string | null;
  supersededById: string | null;
  sourceUrlAvailable: boolean;
  title: string | null;
  episode: number | null;
  hasItems: boolean;
  sourcePaths: Array<{ path: string; exists: boolean }>;
  targetPaths: Array<{ path: string; exists: boolean }>;
  archivedEvidencePaths: string[];
  hasBlockingPlan: boolean;
};

export type OrganizerRepairItem = {
  actionId: string;
  kind: OrganizerRepairKind;
  executable: boolean;
  confidence: "high" | "medium" | "low";
  reason: string;
  planIds: string[];
  downloadId: string | null;
  title: string | null;
  episode: number | null;
  sourcePaths: string[];
  evidencePaths: string[];
};

export type OrganizerRepairPlan = {
  planId: string;
  createdAt: string;
  summary: {
    plans: number;
    rejectedPlans: number;
    reviewPlans: number;
    actions: number;
    executable: number;
    review: number;
    byKind: Record<OrganizerRepairKind, number>;
  };
  items: OrganizerRepairItem[];
};

type RepairablePlanRecord = Awaited<ReturnType<typeof loadRepairablePlans>>[number];

export async function createOrganizerRepairPlan(): Promise<OrganizerRepairPlan> {
  const settings = await getAppSettings();
  const libraryRoots = [
    settings.directories.animeLibraryDir,
    settings.directories.moviesLibraryDir,
    settings.directories.tvLibraryDir,
  ].map((value) => path.resolve(value));
  const plans = await loadRepairablePlans();
  const blockingPlans = await prisma.organizerPlan.findMany({
    where: {
      status: { not: "REJECTED" },
      downloadId: { not: null },
      items: { some: {} },
    },
    select: {
      downloadId: true,
      items: { select: { targetPath: true } },
    },
  });

  const paths = new Set<string>();
  for (const plan of plans) {
    for (const item of plan.items) {
      paths.add(item.sourcePath);
      if (isInsideAnyRoot(item.targetPath, libraryRoots)) {
        paths.add(item.targetPath);
      }
    }
  }
  for (const plan of blockingPlans) {
    for (const item of plan.items) {
      if (isInsideAnyRoot(item.targetPath, libraryRoots)) {
        paths.add(item.targetPath);
      }
    }
  }
  const existence = new Map(
    await Promise.all(
      [...paths].map(async (filePath) => [filePath, await regularFileExists(filePath, settings.directories.dataRoot)] as const),
    ),
  );

  const archivedBySource = new Map<string, Set<string>>();
  for (const plan of plans) {
    for (const item of plan.items) {
      if (
        item.sourcePath !== item.targetPath &&
        isInsideAnyRoot(item.targetPath, libraryRoots) &&
        existence.get(item.targetPath)
      ) {
        const targets = archivedBySource.get(item.sourcePath) ?? new Set<string>();
        targets.add(item.targetPath);
        archivedBySource.set(item.sourcePath, targets);
      }
    }
  }

  const blockingByDownload = new Map<string, string[]>();
  for (const plan of blockingPlans) {
    if (!plan.downloadId) {
      continue;
    }
    const targets = plan.items
      .map((item) => item.targetPath)
      .filter((targetPath) => existence.get(targetPath));
    blockingByDownload.set(plan.downloadId, [
      ...(blockingByDownload.get(plan.downloadId) ?? []),
      ...targets,
    ]);
  }

  const grouped = groupRepairablePlans(plans);
  const groups: OrganizerRepairGroup[] = [];
  for (const group of grouped.values()) {
    const first = group[0];
    const sourcePaths = unique(group.flatMap((plan) => plan.items.map((item) => item.sourcePath)));
    const targetPaths = unique(
      group
        .flatMap((plan) => plan.items)
        .filter(
          (item) => item.sourcePath !== item.targetPath && isInsideAnyRoot(item.targetPath, libraryRoots),
        )
        .map((item) => item.targetPath),
    );
    const evidence = new Set<string>();
    for (const sourcePath of sourcePaths) {
      for (const targetPath of archivedBySource.get(sourcePath) ?? []) {
        evidence.add(targetPath);
      }
    }
    for (const targetPath of targetPaths) {
      if (existence.get(targetPath)) {
        evidence.add(targetPath);
      }
    }
    if (first.downloadId) {
      for (const targetPath of blockingByDownload.get(first.downloadId) ?? []) {
        evidence.add(targetPath);
      }
    }
    if (evidence.size === 0) {
      for (const archivedPath of await findArchivedCandidatePaths(group, settings.directories.dataRoot)) {
        evidence.add(archivedPath);
      }
    }

    groups.push({
      key: first.downloadId ? `download:${first.downloadId}` : `plan:${first.id}`,
      planIds: group.map((plan) => plan.id).sort(),
      statuses: group.map((plan) => plan.status),
      downloadId: first.downloadId,
      downloadStatus: first.download?.status ?? null,
      archiveStatus: first.download?.archiveStatus ?? null,
      supersededById: first.download?.supersededById ?? null,
      sourceUrlAvailable: Boolean(first.download?.sourceUrl?.trim()),
      title:
        first.candidate?.group?.displayTitle ??
        first.candidate?.parsedTitle ??
        first.download?.title ??
        null,
      episode:
        first.candidate?.episodeNumber ??
        parseDownloadIdentity(first.download?.targetPath, first.mediaType).episodeNumber ??
        null,
      hasItems: group.some((plan) => plan.items.length > 0),
      sourcePaths: sourcePaths.map((filePath) => ({ path: filePath, exists: existence.get(filePath) ?? false })),
      targetPaths: targetPaths.map((filePath) => ({ path: filePath, exists: existence.get(filePath) ?? false })),
      archivedEvidencePaths: [...evidence].sort(),
      hasBlockingPlan: Boolean(first.downloadId && blockingByDownload.has(first.downloadId)),
    });
  }

  return buildOrganizerRepairPlan(groups);
}

export function buildOrganizerRepairPlan(groups: OrganizerRepairGroup[]): OrganizerRepairPlan {
  const items = groups.map(classifyOrganizerRepairGroup);
  const planId = stableHash(
    items.map((item) => ({
      actionId: item.actionId,
      kind: item.kind,
      planIds: item.planIds,
      downloadId: item.downloadId,
      sourcePaths: item.sourcePaths,
      evidencePaths: item.evidencePaths,
    })),
  );
  const kinds: OrganizerRepairKind[] = [
    "delete_stale",
    "resolve_archived",
    "regenerate",
    "retry_missing",
    "wait_download",
    "manual_review",
  ];
  const byKind = Object.fromEntries(
    kinds.map((kind) => [kind, items.filter((item) => item.kind === kind).length]),
  ) as Record<OrganizerRepairKind, number>;
  return {
    planId,
    createdAt: new Date().toISOString(),
    summary: {
      plans: groups.reduce((total, group) => total + group.planIds.length, 0),
      rejectedPlans: groups.reduce(
        (total, group) => total + group.statuses.filter((status) => status === "REJECTED").length,
        0,
      ),
      reviewPlans: groups.reduce(
        (total, group) => total + group.statuses.filter((status) => status === "NEEDS_REVIEW").length,
        0,
      ),
      actions: items.length,
      executable: items.filter((item) => item.executable).length,
      review: items.filter((item) => !item.executable).length,
      byKind,
    },
    items,
  };
}

export async function executeOrganizerRepairPlan(input: {
  planId: string;
  actionIds: string[];
  confirmation: string;
}) {
  if (input.confirmation !== ORGANIZER_REPAIR_CONFIRMATION) {
    throw new OrganizerRepairValidationError("Organizer repair confirmation phrase does not match.");
  }
  const plan = await createOrganizerRepairPlan();
  if (plan.planId !== input.planId) {
    throw new OrganizerRepairPlanStaleError(
      "Organizer repair plan is stale. Generate a new dry-run plan before applying changes.",
    );
  }
  const selected = new Set(input.actionIds);
  if (selected.size !== input.actionIds.length) {
    throw new OrganizerRepairValidationError("Organizer repair action IDs must be unique.");
  }
  const requested = plan.items.filter((item) => selected.has(item.actionId));
  if (requested.length !== selected.size) {
    throw new OrganizerRepairValidationError("One or more actions are not part of the current plan.");
  }
  if (requested.some((item) => !item.executable)) {
    throw new OrganizerRepairValidationError("Review-only organizer repair actions cannot be executed.");
  }

  const results: Array<{
    actionId: string;
    kind: OrganizerRepairKind;
    status: "succeeded" | "failed";
    message: string;
  }> = [];
  for (const item of requested) {
    try {
      await executeOrganizerRepairItem(item);
      results.push({ actionId: item.actionId, kind: item.kind, status: "succeeded", message: item.reason });
    } catch (error) {
      results.push({
        actionId: item.actionId,
        kind: item.kind,
        status: "failed",
        message: error instanceof Error ? error.message : "Unexpected organizer repair error",
      });
    }
  }
  return {
    planId: plan.planId,
    requested: requested.length,
    succeeded: results.filter((result) => result.status === "succeeded").length,
    failed: results.filter((result) => result.status === "failed").length,
    results,
  };
}

function classifyOrganizerRepairGroup(group: OrganizerRepairGroup): OrganizerRepairItem {
  const sourcePaths = group.sourcePaths.filter((item) => item.exists).map((item) => item.path);
  const evidencePaths = unique([
    ...group.archivedEvidencePaths,
    ...group.targetPaths.filter((item) => item.exists).map((item) => item.path),
  ]);
  const base = {
    planIds: group.planIds,
    downloadId: group.downloadId,
    title: group.title,
    episode: group.episode,
    sourcePaths,
    evidencePaths,
  };
  if (!group.downloadId) {
    return repairItem(base, sourcePaths.length > 0
      ? {
          kind: "manual_review",
          executable: false,
          confidence: "low",
          reason: "The source still exists, but the rejected plan has no linked download.",
        }
      : {
          kind: "delete_stale",
          executable: true,
          confidence: "high",
          reason: evidencePaths.length > 0
            ? "The import source is gone and an archived target exists."
            : "The unlinked import source and target are both gone.",
        });
  }
  if (["ACTIVE", "WAITING", "PAUSED"].includes(group.downloadStatus ?? "")) {
    return repairItem(base, {
      kind: "wait_download",
      executable: false,
      confidence: "high",
      reason: `The linked download is ${group.downloadStatus?.toLowerCase()} and must finish before organizing.`,
    });
  }
  if (group.supersededById) {
    return repairItem(base, {
      kind: "delete_stale",
      executable: true,
      confidence: "high",
      reason: `The linked download is superseded by ${group.supersededById}.`,
    });
  }
  if (evidencePaths.length > 0) {
    return repairItem(base, {
      kind: "resolve_archived",
      executable: true,
      confidence: "high",
      reason: "A matching archived media file exists; repair the download state and remove rejected history.",
    });
  }
  if (sourcePaths.length > 0) {
    if (group.statuses.some((status) => status !== "REJECTED")) {
      return repairItem(base, {
        kind: "manual_review",
        executable: false,
        confidence: "low",
        reason: "The orphaned review still has a source file, but no matching archived-file evidence was found.",
      });
    }
    return repairItem(base, group.hasBlockingPlan
      ? {
          kind: "manual_review",
          executable: false,
          confidence: "low",
          reason: "The source exists, but another organizer plan blocks regeneration without archived-file evidence.",
        }
      : {
          kind: "regenerate",
          executable: true,
          confidence: "medium",
          reason: "The source file exists and no meaningful organizer plan blocks safe regeneration.",
        });
  }
  if (!group.hasItems && group.archiveStatus === "archived") {
    return repairItem(base, {
      kind: "delete_stale",
      executable: true,
      confidence: "high",
      reason: "The empty rejected plan belongs to a download already marked archived.",
    });
  }
  if (group.statuses.some((status) => status !== "REJECTED")) {
    return repairItem(base, {
      kind: "manual_review",
      executable: false,
      confidence: "low",
      reason: "The orphaned review has no verified archived-file evidence and cannot be retried safely.",
    });
  }
  if (
    (group.downloadStatus === "COMPLETED" || group.downloadStatus === "FAILED") &&
    group.sourceUrlAvailable
  ) {
    return repairItem(base, {
      kind: "retry_missing",
      executable: true,
      confidence: "medium",
      reason: "Neither source nor archived media exists; retry the single linked download from its saved source.",
    });
  }
  return repairItem(base, {
    kind: "manual_review",
    executable: false,
    confidence: "low",
    reason: "No safe automatic recovery path was found.",
  });
}

function repairItem(
  base: Omit<OrganizerRepairItem, "actionId" | "kind" | "executable" | "confidence" | "reason">,
  action: Pick<OrganizerRepairItem, "kind" | "executable" | "confidence" | "reason">,
): OrganizerRepairItem {
  return {
    ...base,
    ...action,
    actionId: `${action.kind}:${stableHash({ planIds: base.planIds, downloadId: base.downloadId }).slice(0, 16)}`,
  };
}

async function executeOrganizerRepairItem(item: OrganizerRepairItem) {
  if (item.kind === "delete_stale") {
    return prisma.organizerPlan.updateMany({
      where: {
        id: { in: item.planIds },
        status: { in: ["REJECTED", "NEEDS_REVIEW"] },
        resolvedAt: null,
      },
      data: { resolvedAt: new Date(), resolution: item.reason },
    });
  }
  if (item.kind === "resolve_archived") {
    if (!item.downloadId || item.evidencePaths.length === 0) {
      throw new Error("Archived-file evidence or linked download is missing.");
    }
    return prisma.$transaction(async (transaction) => {
      await transaction.organizerPlan.updateMany({
        where: {
          id: { in: item.planIds },
          status: { in: ["REJECTED", "NEEDS_REVIEW"] },
          resolvedAt: null,
        },
        data: {
          status: "REJECTED",
          resolvedAt: new Date(),
          resolution: item.reason,
        },
      });
      return transaction.download.update({
        where: { id: item.downloadId as string },
        data: {
          archiveStatus: "archived",
          errorMessage: null,
          repairNote: `Organizer repair confirmed archived media: ${item.evidencePaths[0]}`,
        },
      });
    });
  }
  if (item.kind === "regenerate") {
    const [planId, ...duplicates] = item.planIds;
    if (!planId) {
      throw new Error("Rejected organizer plan ID is missing.");
    }
    const replacement = await regenerateRejectedOrganizerPlan(planId);
    if (duplicates.length > 0) {
      await prisma.organizerPlan.updateMany({
        where: { id: { in: duplicates }, status: "REJECTED", resolvedAt: null },
        data: {
          resolvedAt: new Date(),
          resolution: `Duplicate rejected history resolved by organizer plan ${replacement.id}.`,
        },
      });
    }
    return replacement;
  }
  if (item.kind === "retry_missing") {
    if (!item.downloadId) {
      throw new Error("Linked download is missing.");
    }
    const download = await prisma.download.findUniqueOrThrow({ where: { id: item.downloadId } });
    if (download.status === "COMPLETED") {
      await prisma.download.update({
        where: { id: download.id },
        data: {
          status: "FAILED",
          archiveStatus: null,
          errorMessage: "Organizer repair confirmed the completed file is missing.",
          repairNote: "Retrying a completed download whose source and archived target are missing.",
        },
      });
    } else if (download.status !== "FAILED") {
      throw new Error(`Download status changed to ${download.status}; retry was not started.`);
    }
    const retried = await retryFailedDownload(download.id);
    if (retried.status === "FAILED") {
      throw new Error(retried.errorMessage || "Download remains failed after retry.");
    }
    await prisma.organizerPlan.updateMany({
      where: { id: { in: item.planIds }, status: "REJECTED", resolvedAt: null },
      data: {
        resolvedAt: new Date(),
        resolution: `Missing source recovery restarted as download ${retried.id}.`,
      },
    });
    return retried;
  }
  throw new Error("Review-only organizer repair actions cannot be executed.");
}

async function loadRepairablePlans() {
  return prisma.organizerPlan.findMany({
    where: {
      resolvedAt: null,
      OR: [
        { status: "REJECTED" },
        {
          status: "NEEDS_REVIEW",
          candidateId: null,
          items: { none: {} },
        },
      ],
    },
    orderBy: { createdAt: "asc" },
    include: {
      items: true,
      download: {
        select: {
          status: true,
          archiveStatus: true,
          supersededById: true,
          sourceUrl: true,
          targetPath: true,
          title: true,
          totalBytes: true,
        },
      },
      candidate: { include: { group: true } },
    },
  });
}

function groupRepairablePlans(plans: RepairablePlanRecord[]) {
  const grouped = new Map<string, RepairablePlanRecord[]>();
  for (const plan of plans) {
    const key = plan.downloadId ? `download:${plan.downloadId}` : `plan:${plan.id}`;
    grouped.set(key, [...(grouped.get(key) ?? []), plan]);
  }
  return grouped;
}

async function findArchivedCandidatePaths(plans: RepairablePlanRecord[], dataRoot: string) {
  const candidates = uniqueBy(
    plans.map((plan) => plan.candidate).filter((candidate) => candidate?.episodeNumber !== null),
    (candidate) => candidate?.id ?? "",
  );
  const matches = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || candidate.episodeNumber === null) {
      continue;
    }
    const media = await findExistingMediaTitle({
      type: candidate.mediaType as MediaType,
      title: candidate.group?.displayTitle ?? candidate.parsedTitle,
      aliases: [
        candidate.parsedTitle,
        candidate.normalizedTitle,
        candidate.group?.normalizedTitle,
        ...stringArray(candidate.group?.aliases),
      ],
    });
    if (!media) {
      continue;
    }
    const files = await prisma.mediaFile.findMany({
      where: {
        episode: {
          number: candidate.episodeNumber,
          season: { mediaId: media.id, number: candidate.season ?? 1 },
        },
      },
      select: { absolutePath: true },
    });
    for (const file of files) {
      if (await regularFileExists(file.absolutePath, dataRoot)) {
        matches.add(file.absolutePath);
      }
    }
  }
  for (const plan of plans) {
    const download = plan.download;
    const identity = parseDownloadIdentity(download?.targetPath, plan.mediaType);
    if (!download || identity.episodeNumber === null) {
      continue;
    }
    const title = download.title?.trim() || identity.parsedTitle;
    if (!title) {
      continue;
    }
    const media = await findExistingMediaTitle({
      type: plan.mediaType as MediaType,
      title,
      aliases: [
        identity.parsedTitle,
        ...title.split(/\s*\/\s*/g),
      ],
    });
    if (!media) {
      continue;
    }
    const files = await prisma.mediaFile.findMany({
      where: {
        ...(download.totalBytes !== null ? { sizeBytes: download.totalBytes } : {}),
        episode: {
          number: identity.episodeNumber,
          season: {
            mediaId: media.id,
            number: identity.season,
          },
        },
      },
      select: { absolutePath: true },
    });
    for (const file of files) {
      if (await regularFileExists(file.absolutePath, dataRoot)) {
        matches.add(file.absolutePath);
      }
    }
  }
  return [...matches];
}

function parseDownloadIdentity(targetPath: string | null | undefined, mediaType: MediaType) {
  if (!targetPath) {
    return { parsedTitle: "", episodeNumber: null, season: 1 };
  }
  const parsed = parseMediaReleaseTitle(
    path.basename(targetPath, path.extname(targetPath)),
    mediaType,
  );
  return {
    parsedTitle: parsed.parsedTitle,
    episodeNumber:
      parsed.episodeNumber !== undefined && parsed.episodeNumber > 0
        ? Math.floor(parsed.episodeNumber)
        : null,
    season: parsed.season ?? 1,
  };
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isInsideAnyRoot(candidatePath: string, roots: string[]) {
  const candidate = path.resolve(candidatePath);
  return roots.some((root) => isInsideRoot(candidate, root));
}

async function regularFileExists(candidatePath: string, dataRoot: string) {
  const resolved = path.resolve(candidatePath);
  if (!isInsideRoot(resolved, path.resolve(dataRoot))) {
    return false;
  }
  const stat = await fs.lstat(resolved).catch(() => null);
  return Boolean(stat?.isFile() && !stat.isSymbolicLink());
}

function isInsideRoot(candidate: string, root: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function uniqueBy<T>(values: T[], key: (value: T) => string) {
  return [...new Map(values.map((value) => [key(value), value])).values()];
}

function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
