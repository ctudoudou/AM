import path from "node:path";
import type { CandidateStatus, MediaType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeTitleAliases } from "@/lib/anime-parser";
import { parseMediaReleaseTitle, type ParsedMediaRelease } from "@/lib/media-parser";
import { classifyReleaseResource } from "@/lib/release-resource";
import { repairCandidateGroups } from "@/lib/candidate-grouper";
import {
  cleanupPollutedOrganizerPlans,
  cleanupStaleOrganizerPlans,
} from "@/lib/organizer";
import { repairAnimeEpisodeNumbering } from "@/lib/wanted-episodes";

const maxIssueSamples = 40;
const suspiciousTitleTokens = [
  "简／繁",
  "簡／繁",
  "简繁",
  "簡繁",
  "年龄限制版",
  "年齡限制版",
  "无修版",
  "無修版",
  "无修正版",
  "無修正版",
  "放送版",
  "TV版",
  "WEB-DL",
  "WEBRip",
  "1080p",
  "720p",
];

export type DataHealthIssueSeverity = "info" | "warning" | "danger";
export type DataHealthIssueType =
  | "parser_replay"
  | "non_video_candidate"
  | "polluted_group"
  | "split_group"
  | "organizer_plan"
  | "media_path";

export type DataHealthIssue = {
  id: string;
  type: DataHealthIssueType;
  severity: DataHealthIssueSeverity;
  title: string;
  description: string;
  count: number;
  autoFixable: boolean;
  samples: Array<Record<string, unknown>>;
};

export type DataHealthScan = {
  generatedAt: string;
  summary: {
    score: number;
    candidatesScanned: number;
    parserReplayIssues: number;
    pollutedGroups: number;
    splitGroups: number;
    organizerIssues: number;
    pollutedMediaFiles: number;
    autoFixableIssues: number;
  };
  issues: DataHealthIssue[];
};

export type DataHealthRepairResult = {
  repair: {
    candidateGroups: Awaited<ReturnType<typeof repairCandidateGroups>>;
    organizerCleanup: Awaited<ReturnType<typeof cleanupPollutedOrganizerPlans>>;
    stalePlans: Awaited<ReturnType<typeof cleanupStaleOrganizerPlans>>;
    episodeNumbering: Awaited<ReturnType<typeof repairAnimeEpisodeNumbering>>;
  };
  scan: DataHealthScan;
};

type CandidateSnapshot = {
  id: string;
  groupId: string | null;
  mediaType: MediaType;
  status: CandidateStatus;
  rawTitle: string;
  parsedTitle: string;
  normalizedTitle: string;
  episodeNumber: number | null;
  season: number | null;
  group: {
    id: string;
    displayTitle: string;
    normalizedTitle: string;
    aliases: unknown;
  } | null;
};

export async function scanDataHealth(): Promise<DataHealthScan> {
  const [candidates, groups, activePlans, pollutedMediaFiles, pollutedMediaFileCount] =
    await Promise.all([
      prisma.releaseCandidate.findMany({
        where: {
          status: { in: ["NEW", "READY", "REVIEW", "SUBSCRIBED", "DOWNLOADED"] },
        },
        include: {
          group: {
            select: {
              id: true,
              displayTitle: true,
              normalizedTitle: true,
              aliases: true,
            },
          },
        },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.releaseCandidateGroup.findMany({
        include: {
          _count: { select: { candidates: true, subscriptions: true } },
        },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.organizerPlan.findMany({
        where: { status: { in: ["PENDING", "NEEDS_REVIEW", "CONFLICT", "FAILED"] } },
        include: {
          items: true,
          candidate: {
            include: {
              group: {
                select: {
                  displayTitle: true,
                  normalizedTitle: true,
                  aliases: true,
                },
              },
            },
          },
        },
        orderBy: { updatedAt: "desc" },
        take: 250,
      }),
      prisma.mediaFile.findMany({
        where: pollutedMediaPathWhere(),
        select: {
          id: true,
          absolutePath: true,
          originalName: true,
        },
        orderBy: { updatedAt: "desc" },
        take: maxIssueSamples,
      }),
      prisma.mediaFile.count({ where: pollutedMediaPathWhere() }),
    ]);

  const replay = collectReplayIssues(candidates);
  const nonVideoCandidates = collectNonVideoCandidateIssues(candidates);
  const pollutedGroups = collectPollutedGroups(groups, candidates);
  const splitGroups = collectSplitGroups(candidates);
  const organizerIssues = collectOrganizerIssues(activePlans);
  const issues: DataHealthIssue[] = [
    ...replay.issues,
    ...nonVideoCandidates,
    ...pollutedGroups,
    ...splitGroups,
    ...organizerIssues,
  ];

  if (pollutedMediaFileCount > 0) {
    issues.push({
      id: "media-path-pollution",
      type: "media_path",
      severity: "warning",
      title: "Polluted media file paths",
      description: "Media library paths contain release tags or parser-noise directory names.",
      count: pollutedMediaFileCount,
      autoFixable: false,
      samples: pollutedMediaFiles.map((file) => ({
        id: file.id,
        originalName: file.originalName,
        absolutePath: file.absolutePath,
      })),
    });
  }

  const dangerWeight = issues
    .map((issue) => (issue.severity === "danger" ? 18 : issue.severity === "warning" ? 9 : 3))
    .reduce((sum, value) => sum + value, 0);
  const score = Math.max(0, Math.min(100, 100 - dangerWeight));

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      score,
      candidatesScanned: candidates.length,
      parserReplayIssues: replay.count,
      pollutedGroups: pollutedGroups.reduce((sum, issue) => sum + issue.count, 0),
      splitGroups: splitGroups.length,
      organizerIssues: organizerIssues.reduce((sum, issue) => sum + issue.count, 0),
      pollutedMediaFiles: pollutedMediaFileCount,
      autoFixableIssues: issues.filter((issue) => issue.autoFixable).length,
    },
    issues,
  };
}

export async function repairDataHealth(): Promise<DataHealthRepairResult> {
  const candidateGroups = await repairCandidateGroups();
  const organizerCleanup = await cleanupPollutedOrganizerPlans();
  const stalePlans = await cleanupStaleOrganizerPlans();
  const episodeNumbering = await repairAnimeEpisodeNumbering();

  return {
    repair: {
      candidateGroups,
      organizerCleanup,
      stalePlans,
      episodeNumbering,
    },
    scan: await scanDataHealth(),
  };
}

export function detectCandidateReplayIssue(
  candidate: CandidateSnapshot,
  parsed: ParsedMediaRelease = parseMediaReleaseTitle(candidate.rawTitle, candidate.mediaType),
) {
  const parsedSeason = parsed.season ?? null;
  const titleChanged = parsed.normalizedTitle !== candidate.normalizedTitle;
  const episodeChanged =
    parsed.episodeNumber !== undefined &&
    candidate.episodeNumber !== null &&
    parsed.episodeNumber !== candidate.episodeNumber;
  const seasonChanged = parsedSeason !== candidate.season && parsedSeason !== null;
  const groupMismatch =
    candidate.group &&
    parsed.normalizedTitle !== candidate.group.normalizedTitle &&
    !groupAliases(candidate.group).has(parsed.normalizedTitle);

  if (!titleChanged && !episodeChanged && !seasonChanged && !groupMismatch) {
    return null;
  }

  return {
    candidateId: candidate.id,
    groupId: candidate.groupId,
    rawTitle: candidate.rawTitle,
    oldParsedTitle: candidate.parsedTitle,
    oldNormalizedTitle: candidate.normalizedTitle,
    newParsedTitle: parsed.parsedTitle,
    newNormalizedTitle: parsed.normalizedTitle,
    oldEpisode: candidate.episodeNumber,
    newEpisode: parsed.episodeNumber ?? null,
    oldSeason: candidate.season,
    newSeason: parsedSeason,
    groupTitle: candidate.group?.displayTitle ?? null,
    groupNormalizedTitle: candidate.group?.normalizedTitle ?? null,
  };
}

export function isSuspiciousTitleToken(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return (
    suspiciousTitleTokens.some((token) => normalized === token.toLowerCase()) ||
    /^(?:chs|cht|gb|big5|aac|avc|hevc|x26[45]|h\.?26[45]|web|tv|mp4|mkv)$/i.test(normalized) ||
    /^(?:\d{3,4}p|4k)$/.test(normalized)
  );
}

function collectReplayIssues(candidates: CandidateSnapshot[]) {
  const samples = candidates
    .map((candidate) => detectCandidateReplayIssue(candidate))
    .filter((issue): issue is NonNullable<typeof issue> => Boolean(issue));

  return {
    count: samples.length,
    issues:
      samples.length > 0
        ? [
            {
              id: "parser-replay",
              type: "parser_replay" as const,
              severity: "warning" as const,
              title: "Parser replay drift",
              description:
                "Current parser output differs from stored candidate title, episode, season, or group identity.",
              count: samples.length,
              autoFixable: true,
              samples: samples.slice(0, maxIssueSamples),
            },
          ]
        : [],
  };
}

function collectNonVideoCandidateIssues(candidates: CandidateSnapshot[]) {
  const samples = candidates
    .map((candidate) => ({
      candidate,
      resource: classifyReleaseResource(candidate.rawTitle),
    }))
    .filter((item) => item.resource.kind === "NON_VIDEO");

  if (samples.length === 0) {
    return [];
  }

  return [
    {
      id: "non-video-candidates",
      type: "non_video_candidate" as const,
      severity: "danger" as const,
      title: "Non-video RSS candidates",
      description:
        "RSS intake contains music, album, or audio-only releases that should not enter anime candidate grouping.",
      count: samples.length,
      autoFixable: true,
      samples: samples.slice(0, maxIssueSamples).map(({ candidate, resource }) => ({
        id: candidate.id,
        rawTitle: candidate.rawTitle,
        parsedTitle: candidate.parsedTitle,
        groupTitle: candidate.group?.displayTitle ?? null,
        reason: resource.reason ?? null,
      })),
    },
  ];
}

function collectPollutedGroups(
  groups: Array<{
    id: string;
    displayTitle: string;
    normalizedTitle: string;
    _count: { candidates: number; subscriptions: number };
  }>,
  candidates: CandidateSnapshot[],
) {
  const candidatesByGroup = new Map<string, CandidateSnapshot[]>();
  for (const candidate of candidates) {
    if (!candidate.groupId) {
      continue;
    }
    const list = candidatesByGroup.get(candidate.groupId) ?? [];
    list.push(candidate);
    candidatesByGroup.set(candidate.groupId, list);
  }

  const polluted = groups.filter((group) => {
    if (group._count.candidates === 0 && group._count.subscriptions === 0) {
      return true;
    }
    if (isSuspiciousTitleToken(group.normalizedTitle) || isSuspiciousTitleToken(group.displayTitle)) {
      return true;
    }
    const scoped = candidatesByGroup.get(group.id) ?? [];
    if (scoped.length === 0) {
      return false;
    }
    const mismatches = scoped.filter((candidate) => {
      const parsed = parseMediaReleaseTitle(candidate.rawTitle, candidate.mediaType);
      return parsed.normalizedTitle !== group.normalizedTitle && !groupAliases(group).has(parsed.normalizedTitle);
    });
    return mismatches.length >= Math.max(2, Math.ceil(scoped.length * 0.8));
  });

  if (polluted.length === 0) {
    return [];
  }

  return [
    {
      id: "polluted-groups",
      type: "polluted_group" as const,
      severity: "danger" as const,
      title: "Polluted candidate groups",
      description:
        "Some candidate groups look like subtitle, edition, source, or technical tags instead of media titles.",
      count: polluted.length,
      autoFixable: true,
      samples: polluted.slice(0, maxIssueSamples).map((group) => ({
        id: group.id,
        displayTitle: group.displayTitle,
        normalizedTitle: group.normalizedTitle,
        candidates: group._count.candidates,
        subscriptions: group._count.subscriptions,
      })),
    },
  ];
}

function collectSplitGroups(candidates: CandidateSnapshot[]) {
  const parsedTargets = new Map<string, Map<string, CandidateSnapshot[]>>();
  for (const candidate of candidates) {
    if (!candidate.groupId) {
      continue;
    }
    const parsed = parseMediaReleaseTitle(candidate.rawTitle, candidate.mediaType);
    const key = `${parsed.mediaType}:${parsed.normalizedTitle}:${parsed.season ?? 1}`;
    const groups = parsedTargets.get(key) ?? new Map<string, CandidateSnapshot[]>();
    const list = groups.get(candidate.groupId) ?? [];
    list.push(candidate);
    groups.set(candidate.groupId, list);
    parsedTargets.set(key, groups);
  }

  const split = [...parsedTargets.entries()]
    .filter(([, groups]) => groups.size > 1)
    .map(([key, groups]) => ({
      key,
      groups: [...groups.entries()].map(([groupId, items]) => ({
        groupId,
        count: items.length,
        title: items[0]?.group?.displayTitle ?? items[0]?.parsedTitle,
      })),
    }));

  if (split.length === 0) {
    return [];
  }

  return [
    {
      id: "split-groups",
      type: "split_group" as const,
      severity: "warning" as const,
      title: "Split candidate groups",
      description: "The latest parser maps one media title to multiple current candidate groups.",
      count: split.length,
      autoFixable: true,
      samples: split.slice(0, maxIssueSamples),
    },
  ];
}

function collectOrganizerIssues(
  plans: Array<{
    id: string;
    status: string;
    reason: string | null;
    items: Array<{ sourcePath: string; targetPath: string }>;
    candidate: {
      mediaType: MediaType;
      parsedTitle: string;
      normalizedTitle: string;
      group: { displayTitle: string; normalizedTitle: string; aliases: unknown } | null;
    } | null;
  }>,
) {
  const problematic = plans.filter((plan) => {
    if (plan.items.length === 0) {
      return true;
    }
    if (plan.items.some((item) => pathContainsSuspiciousToken(item.targetPath))) {
      return true;
    }
    if (!plan.candidate) {
      return false;
    }
    const aliases = groupAliases({
      displayTitle: plan.candidate.group?.displayTitle ?? plan.candidate.parsedTitle,
      normalizedTitle: plan.candidate.group?.normalizedTitle ?? plan.candidate.normalizedTitle,
      aliases: plan.candidate.group?.aliases,
    });
    return plan.items.every((item) => {
      const parsed = parseMediaReleaseTitle(
        path.basename(item.sourcePath, path.extname(item.sourcePath)),
        plan.candidate?.mediaType ?? "ANIME",
      );
      return !aliases.has(parsed.normalizedTitle);
    });
  });

  if (problematic.length === 0) {
    return [];
  }

  return [
    {
      id: "organizer-plan-health",
      type: "organizer_plan" as const,
      severity: "warning" as const,
      title: "Organizer plans need cleanup",
      description:
        "Active organizer plans have empty items, suspicious target paths, or source files that do not match their candidate title.",
      count: problematic.length,
      autoFixable: true,
      samples: problematic.slice(0, maxIssueSamples).map((plan) => ({
        id: plan.id,
        status: plan.status,
        reason: plan.reason,
        items: plan.items.length,
        targetPath: plan.items[0]?.targetPath,
      })),
    },
  ];
}

function groupAliases(group: { displayTitle?: string | null; normalizedTitle?: string | null; aliases?: unknown }) {
  const aliases = new Set<string>();
  for (const value of [group.displayTitle, group.normalizedTitle]) {
    for (const alias of normalizeTitleAliases(value ?? "")) {
      aliases.add(alias);
    }
  }
  if (Array.isArray(group.aliases)) {
    for (const value of group.aliases) {
      if (typeof value !== "string") {
        continue;
      }
      for (const alias of normalizeTitleAliases(value)) {
        aliases.add(alias);
      }
    }
  }
  return aliases;
}

function pollutedMediaPathWhere() {
  return {
    OR: suspiciousTitleTokens.map((token) => ({ absolutePath: { contains: token } })),
  };
}

function pathContainsSuspiciousToken(value: string) {
  return suspiciousTitleTokens.some((token) => value.includes(token));
}
