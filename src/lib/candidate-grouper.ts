import { Prisma, type MediaType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { groupCandidatesWithOpenRouter } from "@/lib/openrouter";
import { parseMediaReleaseTitle } from "@/lib/media-parser";

export async function groupUngroupedCandidates(
  limit = 50,
  options: { regroupExisting?: boolean; candidateIds?: string[] } = {},
) {
  const candidates = await prisma.releaseCandidate.findMany({
    where: {
      ...(options.candidateIds ? { id: { in: options.candidateIds } } : {}),
      ...(options.regroupExisting ? {} : { groupId: null }),
      status: { in: ["NEW", "READY", "REVIEW"] },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  if (candidates.length === 0) {
    return { grouped: 0 };
  }

  const normalizedCandidates = [];
  for (const candidate of candidates) {
    const parsed = parseMediaReleaseTitle(candidate.rawTitle, candidate.mediaType);
    const updated = await prisma.releaseCandidate.update({
      where: { id: candidate.id },
      data: {
        mediaType: parsed.mediaType,
        parsedTitle: parsed.parsedTitle,
        normalizedTitle: parsed.normalizedTitle,
        subtitleGroup: parsed.subtitleGroup,
        episodeNumber: parsed.episodeNumber,
        season: parsed.season,
        resolution: parsed.resolution,
        codec: parsed.codec,
        audio: parsed.audio,
        subtitleLanguage: parsed.subtitleLanguage,
        releaseProfile: parsed.releaseProfile,
        sourceKind: parsed.sourceKind,
        variantKey: parsed.variantKey,
        releaseTags: parsed.releaseTags,
        groupId: options.regroupExisting ? null : candidate.groupId,
      },
    });
    normalizedCandidates.push(updated);
  }

  const groups = [];
  for (const mediaType of ["ANIME", "MOVIE", "TV"] as const) {
    const scopedCandidates = normalizedCandidates.filter(
      (candidate) => candidate.mediaType === mediaType,
    );
    if (scopedCandidates.length === 0) {
      continue;
    }
    const aiInputs = scopedCandidates.map((candidate) => ({
      id: candidate.id,
      rawTitle: candidate.rawTitle,
      parsedTitle: candidate.parsedTitle,
      normalizedTitle: candidate.normalizedTitle,
      episodeNumber: candidate.episodeNumber,
      season: candidate.season,
      subtitleGroup: candidate.subtitleGroup,
      resolution: candidate.resolution,
      codec: candidate.codec,
    }));
    const mediaGroups =
      mediaType === "ANIME"
        ? await groupCandidatesWithOpenRouter(aiInputs)
        : heuristicMediaGroups(mediaType, aiInputs);
    groups.push(...mediaGroups.map((group) => ({ ...group, mediaType })));
  }

  let grouped = 0;
  for (const group of groups) {
    const season = group.season ?? 1;
    const record = await prisma.releaseCandidateGroup.upsert({
      where: {
        mediaType_normalizedTitle_season: {
          mediaType: group.mediaType,
          normalizedTitle: group.normalizedTitle,
          season,
        },
      },
      create: {
        mediaType: group.mediaType,
        normalizedTitle: group.normalizedTitle,
        displayTitle: group.displayTitle,
        season,
        confidence: group.confidence,
        reviewRequired: group.confidence < 0.82,
        aiSummary: group.summary,
        aliases: group.aliases as Prisma.InputJsonValue,
      },
      update: {
        mediaType: group.mediaType,
        displayTitle: group.displayTitle,
        confidence: group.confidence,
        reviewRequired: group.confidence < 0.82,
        aiSummary: group.summary,
        aliases: group.aliases as Prisma.InputJsonValue,
      },
    });

    const updated = await prisma.releaseCandidate.updateMany({
      where: { id: { in: group.candidateIds } },
      data: {
        groupId: record.id,
        status: group.confidence >= 0.82 ? "READY" : "REVIEW",
        confidence: group.confidence,
      },
    });
    grouped += updated.count;
  }

  await prisma.rssItem.updateMany({
    where: {
      candidate: {
        groupId: { not: null },
      },
      status: "PARSED",
    },
    data: { status: "GROUPED" },
  });

  if (options.regroupExisting) {
    await prisma.releaseCandidateGroup.deleteMany({
      where: {
        subscriptions: { none: {} },
        candidates: { none: {} },
      },
    });
  }

  return { grouped };
}

function heuristicMediaGroups(
  mediaType: MediaType,
  candidates: Array<{
    id: string;
    rawTitle: string;
    parsedTitle: string;
    normalizedTitle: string;
    episodeNumber?: number | null;
    season?: number | null;
    subtitleGroup?: string | null;
    resolution?: string | null;
    codec?: string | null;
  }>,
) {
  const grouped = new Map<string, typeof candidates>();

  for (const candidate of candidates) {
    const season = candidate.season ?? 1;
    const key = `${mediaType}::${candidate.normalizedTitle}::${season}`;
    grouped.set(key, [...(grouped.get(key) ?? []), candidate]);
  }

  return [...grouped.values()].map((items) => ({
    normalizedTitle: items[0].normalizedTitle,
    displayTitle: items[0].parsedTitle,
    season: items[0].season ?? 1,
    candidateIds: items.map((item) => item.id),
    confidence: Math.min(...items.map((item) => 0.72 + (item.resolution ? 0.08 : 0))),
    aliases: [...new Set(items.map((item) => item.parsedTitle))],
    summary:
      mediaType === "MOVIE"
        ? "Rule grouping used for movie intake."
        : "Rule grouping used for TV intake.",
  }));
}
