import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { groupCandidatesWithOpenRouter } from "@/lib/openrouter";
import { parseAnimeReleaseTitle } from "@/lib/anime-parser";

export async function groupUngroupedCandidates(
  limit = 50,
  options: { regroupExisting?: boolean } = {},
) {
  const candidates = await prisma.releaseCandidate.findMany({
    where: {
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
    const parsed = parseAnimeReleaseTitle(candidate.rawTitle);
    const updated = await prisma.releaseCandidate.update({
      where: { id: candidate.id },
      data: {
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

  const groups = await groupCandidatesWithOpenRouter(
    normalizedCandidates.map((candidate) => ({
      id: candidate.id,
      rawTitle: candidate.rawTitle,
      parsedTitle: candidate.parsedTitle,
      normalizedTitle: candidate.normalizedTitle,
      episodeNumber: candidate.episodeNumber,
      season: candidate.season,
      subtitleGroup: candidate.subtitleGroup,
      resolution: candidate.resolution,
      codec: candidate.codec,
    })),
  );

  let grouped = 0;
  for (const group of groups) {
    const season = group.season ?? 1;
    const record = await prisma.releaseCandidateGroup.upsert({
      where: {
        normalizedTitle_season: {
          normalizedTitle: group.normalizedTitle,
          season,
        },
      },
      create: {
        normalizedTitle: group.normalizedTitle,
        displayTitle: group.displayTitle,
        season,
        confidence: group.confidence,
        reviewRequired: group.confidence < 0.82,
        aiSummary: group.summary,
        aliases: group.aliases as Prisma.InputJsonValue,
      },
      update: {
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
