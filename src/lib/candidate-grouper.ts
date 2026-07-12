import { CandidateStatus, Prisma, RssItemStatus, type MediaType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { groupCandidatesWithOpenRouter } from "@/lib/openrouter";
import { parseMediaReleaseTitle } from "@/lib/media-parser";
import {
  candidateGroupIdentityInput,
  createMediaIdentityKeys,
  createStrongMediaIdentityKeys,
  jsonStringList,
  mediaIdentitiesOverlap,
  mediaIdentitiesShareStrongKey,
} from "@/lib/media-identity";
import { classifyReleaseResource, nonVideoReleaseParseError } from "@/lib/release-resource";

type CandidateGroupProposal = {
  normalizedTitle: string;
  displayTitle: string;
  season?: number | null;
  candidateIds: string[];
  confidence: number;
  aliases: string[];
  summary: string;
};

type GroupableCandidate = {
  id: string;
  rawTitle: string;
  parsedTitle: string;
  normalizedTitle: string;
  episodeNumber?: number | null;
  season?: number | null;
  subtitleGroup?: string | null;
  resolution?: string | null;
  codec?: string | null;
};

type RepairCandidate = {
  id: string;
  groupId: string | null;
  mediaType: MediaType;
  status: CandidateStatus;
  rawTitle: string;
  parsedTitle: string;
  normalizedTitle: string;
  season: number | null;
  variantKey: string | null;
};

type RepairSubscription = {
  id: string;
  mediaType: MediaType;
  title: string;
  preferredVariantKey: string | null;
};

export async function groupUngroupedCandidates(
  limit = 50,
  options: { regroupExisting?: boolean; candidateIds?: string[]; useAi?: boolean } = {},
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
    return { grouped: 0, ignored: 0 };
  }

  const normalizedCandidates = [];
  let ignored = 0;
  for (const candidate of candidates) {
    if (await ignoreNonVideoCandidate(candidate)) {
      ignored += 1;
      continue;
    }

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
    const rawGroups =
      mediaType === "ANIME" && options.useAi !== false
        ? await groupCandidatesWithOpenRouter(aiInputs)
        : heuristicMediaGroups(mediaType, aiInputs);
    const mediaGroups = validateGroupProposals(rawGroups, aiInputs)
      ? rawGroups
      : heuristicMediaGroups(
          mediaType,
          aiInputs,
          "Rule grouping used because AI grouping did not cover the candidate set safely.",
        );
    groups.push(...mediaGroups.map((group) => ({ ...group, mediaType })));
  }

  let grouped = 0;
  for (const group of groups) {
    const record = await resolveIntakeTargetGroup(group);

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

  return { grouped, ignored };
}

async function resolveIntakeTargetGroup(group: CandidateGroupProposal & { mediaType: MediaType }) {
  const season = group.season ?? 1;
  const exactGroup = await prisma.releaseCandidateGroup.findUnique({
    where: {
      mediaType_normalizedTitle_season: {
        mediaType: group.mediaType,
        normalizedTitle: group.normalizedTitle,
        season,
      },
    },
    include: {
      _count: { select: { candidates: true, subscriptions: true } },
    },
  });

  const canonicalGroup =
    exactGroup ??
    (await findCanonicalCandidateGroup(group, {
      excludeIds: [],
    }));

  if (canonicalGroup) {
    return prisma.releaseCandidateGroup.update({
      where: { id: canonicalGroup.id },
      data: {
        displayTitle: chooseStableDisplayTitle(canonicalGroup.displayTitle, group.displayTitle),
        confidence: Math.max(canonicalGroup.confidence, group.confidence),
        reviewRequired: canonicalGroup.reviewRequired && group.confidence < 0.82,
        aiSummary: group.summary,
        aliases: mergeGroupAliases(canonicalGroup.aliases, group.aliases, group.displayTitle) as Prisma.InputJsonValue,
      },
    });
  }

  return prisma.releaseCandidateGroup.create({
    data: {
      mediaType: group.mediaType,
      normalizedTitle: group.normalizedTitle,
      displayTitle: group.displayTitle,
      season,
      confidence: group.confidence,
      reviewRequired: group.confidence < 0.82,
      aiSummary: group.summary,
      aliases: group.aliases as Prisma.InputJsonValue,
    },
  });
}

export async function repairCandidateGroups(batchSize = 200) {
  void batchSize;
  const candidates = await prisma.releaseCandidate.findMany({
    where: {
      status: { in: ["NEW", "READY", "REVIEW", "SUBSCRIBED", "DOWNLOADED"] },
    },
    orderBy: { createdAt: "asc" },
  });

  if (candidates.length === 0) {
    return {
      grouped: 0,
      reparsed: 0,
      passes: 1,
      deletedEmptyGroups: 0,
      remainingUngrouped: 0,
      emptyGroups: await countEmptyCandidateGroups(),
      ignored: 0,
    };
  }

  const normalizedCandidates = [];
  let ignored = 0;
  for (const candidate of candidates) {
    if (await ignoreNonVideoCandidate(candidate)) {
      ignored += 1;
      continue;
    }

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
    groups.push(
      ...heuristicMediaGroups(
        mediaType,
        scopedCandidates,
        "Rule repair regrouped existing candidates after title normalization.",
      ).map((group) => ({ ...group, mediaType })),
    );
  }

  let grouped = 0;
  for (const group of groups) {
    const targetGroup = await resolveRepairTargetGroup(group);
    for (const candidateId of group.candidateIds) {
      const candidate = normalizedCandidates.find((item) => item.id === candidateId);
      const preserveStatus =
        candidate?.status === "DOWNLOADED" ||
        candidate?.status === "SUBSCRIBED" ||
        candidate?.status === "IGNORED";
      await prisma.releaseCandidate.update({
        where: { id: candidateId },
        data: {
          groupId: targetGroup.id,
          confidence: group.confidence,
          status: preserveStatus
            ? candidate.status
            : group.confidence >= 0.82
              ? "READY"
              : "REVIEW",
        },
      });
      grouped += 1;
    }
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

  const deleted = await prisma.releaseCandidateGroup.deleteMany({
    where: {
      subscriptions: { none: {} },
      candidates: { none: {} },
    },
  });

  const remainingUngrouped = await prisma.releaseCandidate.count({
    where: {
      groupId: null,
      status: { in: ["NEW", "READY", "REVIEW"] },
    },
  });
  const emptyGroups = await prisma.releaseCandidateGroup.count({
    where: {
      subscriptions: { none: {} },
      candidates: { none: {} },
    },
  });

  return {
    grouped,
    reparsed: normalizedCandidates.length,
    passes: 1,
    deletedEmptyGroups: deleted.count,
    remainingUngrouped,
    emptyGroups,
    ignored,
  };
}

const autoIgnorableCandidateStatuses = new Set<CandidateStatus>([
  CandidateStatus.NEW,
  CandidateStatus.READY,
  CandidateStatus.REVIEW,
]);

async function ignoreNonVideoCandidate(candidate: {
  id: string;
  rawTitle: string;
  status: CandidateStatus;
}) {
  if (!autoIgnorableCandidateStatuses.has(candidate.status)) {
    return false;
  }

  const resource = classifyReleaseResource(candidate.rawTitle);
  if (resource.kind !== "NON_VIDEO") {
    return false;
  }

  await prisma.$transaction([
    prisma.releaseCandidate.update({
      where: { id: candidate.id },
      data: {
        groupId: null,
        status: CandidateStatus.IGNORED,
        confidence: 0,
      },
    }),
    prisma.rssItem.updateMany({
      where: { candidate: { id: candidate.id } },
      data: {
        status: RssItemStatus.FAILED,
        parseError: nonVideoReleaseParseError(resource),
      },
    }),
  ]);
  return true;
}

async function resolveRepairTargetGroup(
  group: CandidateGroupProposal & { mediaType: MediaType },
) {
  const season = group.season ?? 1;
  const candidates = await prisma.releaseCandidate.findMany({
    where: { id: { in: group.candidateIds } },
    select: {
      id: true,
      groupId: true,
      mediaType: true,
      status: true,
      rawTitle: true,
      parsedTitle: true,
      normalizedTitle: true,
      season: true,
      variantKey: true,
    },
  });
  const groupIds = [...new Set(candidates.map((candidate) => candidate.groupId).filter(Boolean))];
  const currentGroups = await prisma.releaseCandidateGroup.findMany({
    where: { id: { in: groupIds as string[] } },
    include: {
      subscriptions: {
        select: {
          id: true,
          mediaType: true,
          title: true,
          preferredVariantKey: true,
        },
      },
      _count: { select: { candidates: true, subscriptions: true } },
    },
  });
  const candidateCountsByGroup = new Map<string, number>();
  for (const candidate of candidates) {
    if (candidate.groupId) {
      candidateCountsByGroup.set(
        candidate.groupId,
        (candidateCountsByGroup.get(candidate.groupId) ?? 0) + 1,
      );
    }
  }

  const canonicalGroup = await prisma.releaseCandidateGroup.findUnique({
    where: {
      mediaType_normalizedTitle_season: {
        mediaType: group.mediaType,
        normalizedTitle: group.normalizedTitle,
        season,
      },
    },
    include: {
      subscriptions: {
        select: {
          id: true,
          mediaType: true,
          title: true,
          preferredVariantKey: true,
        },
      },
      _count: { select: { candidates: true, subscriptions: true } },
    },
  });
  const canonicalIdentityGroup = await findCanonicalCandidateGroup(group, {
    excludeIds: [
      ...currentGroups.map((currentGroup) => currentGroup.id),
      ...(canonicalGroup ? [canonicalGroup.id] : []),
    ],
  });
  const subscribedGroup = currentGroups
    .filter(
      (currentGroup) =>
        currentGroup._count.subscriptions > 0 &&
        repairGroupIsFullyCovered(currentGroup, candidateCountsByGroup),
    )
    .sort((a, b) => b._count.subscriptions - a._count.subscriptions)[0];
  const reusableGroup = currentGroups.find(
    (currentGroup) =>
      currentGroup._count.subscriptions === 0 &&
      repairGroupIsFullyCovered(currentGroup, candidateCountsByGroup),
  );

  const targetGroup =
    subscribedGroup ??
    canonicalIdentityGroup ??
    canonicalGroup ??
    reusableGroup ??
    (await prisma.releaseCandidateGroup.create({
      data: {
        mediaType: group.mediaType,
        normalizedTitle: group.normalizedTitle,
        displayTitle: group.displayTitle,
        season,
        confidence: group.confidence,
        reviewRequired: group.confidence < 0.82,
        aiSummary: group.summary,
        aliases: group.aliases as Prisma.InputJsonValue,
      },
    }));
  const targetGroupId = targetGroup.id;

  if (canonicalGroup && canonicalGroup.id !== targetGroupId) {
    await prisma.releaseCandidate.updateMany({
      where: { groupId: canonicalGroup.id },
      data: { groupId: targetGroupId },
    });
    await moveMatchingRepairSubscriptions(canonicalGroup.subscriptions, targetGroupId, group, candidates);
    await deleteGroupIfEmpty(canonicalGroup.id);
  }

  if (canonicalIdentityGroup && canonicalIdentityGroup.id !== targetGroupId) {
    await prisma.releaseCandidate.updateMany({
      where: { groupId: canonicalIdentityGroup.id },
      data: { groupId: targetGroupId },
    });
    await moveMatchingRepairSubscriptions(canonicalIdentityGroup.subscriptions, targetGroupId, group, candidates);
    await deleteGroupIfEmpty(canonicalIdentityGroup.id);
  }

  for (const currentGroup of currentGroups) {
    if (currentGroup.id === targetGroupId || currentGroup.id === canonicalGroup?.id) {
      continue;
    }
    const shouldMoveAllSubscriptions = repairGroupIsFullyCovered(currentGroup, candidateCountsByGroup);
    await moveMatchingRepairSubscriptions(
      currentGroup.subscriptions,
      targetGroupId,
      group,
      candidates,
      shouldMoveAllSubscriptions,
    );
    await deleteGroupIfEmpty(currentGroup.id);
  }

  return prisma.releaseCandidateGroup.update({
    where: { id: targetGroupId },
    data: {
      mediaType: group.mediaType,
      normalizedTitle: group.normalizedTitle,
      displayTitle: group.displayTitle,
      season,
      confidence: group.confidence,
      reviewRequired: group.confidence < 0.82,
      aiSummary: group.summary,
      aliases: mergeGroupAliases(targetGroup.aliases, group.aliases, group.displayTitle) as Prisma.InputJsonValue,
    },
  });
}

function repairGroupIsFullyCovered(
  group: { id: string; _count: { candidates: number } },
  candidateCountsByGroup: Map<string, number>,
) {
  return group._count.candidates === (candidateCountsByGroup.get(group.id) ?? 0);
}

async function findCanonicalCandidateGroup(
  group: CandidateGroupProposal & { mediaType: MediaType },
  options: { excludeIds: string[] },
) {
  const season = group.season ?? 1;
  const candidates = await prisma.releaseCandidateGroup.findMany({
    where: {
      mediaType: group.mediaType,
      season,
      id: options.excludeIds.length > 0 ? { notIn: options.excludeIds } : undefined,
    },
    include: {
      subscriptions: {
        select: {
          id: true,
          mediaType: true,
          title: true,
          preferredVariantKey: true,
        },
      },
      _count: { select: { candidates: true, subscriptions: true } },
    },
  });

  return candidates
    .filter((candidateGroup) =>
      mediaIdentitiesShareStrongKey(groupIdentityInput(group), groupIdentityInput(candidateGroup)),
    )
    .sort(
      (a, b) =>
        b._count.subscriptions - a._count.subscriptions ||
        b._count.candidates - a._count.candidates ||
        b.confidence - a.confidence ||
        b.updatedAt.getTime() - a.updatedAt.getTime(),
    )[0];
}

function groupIdentityInput(group: {
  mediaType: MediaType;
  displayTitle: string;
  normalizedTitle: string;
  aliases?: unknown;
  season?: number | null;
}) {
  return candidateGroupIdentityInput({ ...group, season: group.season ?? 1 });
}

function mergeGroupAliases(existing: unknown, next: string[], displayTitle: string) {
  return [...new Set([...jsonStringList(existing), ...next, displayTitle].filter(Boolean))];
}

function chooseStableDisplayTitle(existing: string, next: string) {
  const existingHasCjk = /[\u3400-\u9fff]/.test(existing);
  const nextHasCjk = /[\u3400-\u9fff]/.test(next);
  if (nextHasCjk && !existingHasCjk) {
    return next;
  }
  if (existing.length > 80 && next.length <= 80) {
    return next;
  }
  return existing || next;
}

async function moveMatchingRepairSubscriptions(
  subscriptions: RepairSubscription[],
  targetGroupId: string,
  group: CandidateGroupProposal & { mediaType: MediaType },
  candidates: RepairCandidate[],
  forceMove = false,
) {
  const matchingIds = subscriptions
    .filter((subscription) => forceMove || subscriptionBelongsToRepairGroup(subscription, group, candidates))
    .map((subscription) => subscription.id);

  if (matchingIds.length === 0) {
    return;
  }

  await prisma.subscription.updateMany({
    where: { id: { in: matchingIds } },
    data: { candidateGroupId: targetGroupId },
  });
}

function subscriptionBelongsToRepairGroup(
  subscription: RepairSubscription,
  group: CandidateGroupProposal & { mediaType: MediaType },
  candidates: RepairCandidate[],
) {
  if (subscription.mediaType !== group.mediaType) {
    return false;
  }

  if (
    subscription.preferredVariantKey &&
    candidates.some((candidate) => candidate.variantKey === subscription.preferredVariantKey)
  ) {
    return true;
  }

  return mediaIdentitiesOverlap(
    {
      mediaType: subscription.mediaType,
      title: subscription.title,
      season: group.season ?? 1,
    },
    groupIdentityInput(group),
  );
}

async function deleteGroupIfEmpty(groupId: string) {
  await prisma.releaseCandidateGroup.deleteMany({
    where: {
      id: groupId,
      subscriptions: { none: {} },
      candidates: { none: {} },
    },
  });
}

async function countEmptyCandidateGroups() {
  return prisma.releaseCandidateGroup.count({
    where: {
      subscriptions: { none: {} },
      candidates: { none: {} },
    },
  });
}

export function validateGroupProposals(
  groups: CandidateGroupProposal[],
  candidates: Array<{ id: string }>,
) {
  const inputIds = new Set(candidates.map((candidate) => candidate.id));
  const seenIds = new Set<string>();

  if (groups.length === 0 || inputIds.size === 0) {
    return false;
  }

  for (const group of groups) {
    if (!group.candidateIds.length) {
      return false;
    }
    for (const id of group.candidateIds) {
      if (!inputIds.has(id) || seenIds.has(id)) {
        return false;
      }
      seenIds.add(id);
    }
  }

  return seenIds.size === inputIds.size;
}

function heuristicMediaGroups(
  mediaType: MediaType,
  candidates: GroupableCandidate[],
  summary?: string,
) {
  const grouped = mediaType === "ANIME"
    ? groupAnimeCandidatesByAlias(mediaType, candidates)
    : groupCandidatesByNormalizedTitle(mediaType, candidates);

  return [...grouped.values()].map((items) => ({
    normalizedTitle: chooseGroupNormalizedTitle(items),
    displayTitle: chooseGroupDisplayTitle(items),
    season: items[0].season ?? 1,
    candidateIds: items.map((item) => item.id),
    confidence: Math.min(...items.map((item) => 0.72 + (item.resolution ? 0.08 : 0))),
    aliases: [...new Set(items.map((item) => item.parsedTitle))],
    summary:
      summary ??
      (mediaType === "MOVIE"
        ? "Rule grouping used for movie intake."
        : mediaType === "TV"
          ? "Rule grouping used for TV intake."
          : "Rule grouping used for anime intake."),
  }));
}

function groupCandidatesByNormalizedTitle(mediaType: MediaType, candidates: GroupableCandidate[]) {
  const grouped = new Map<string, GroupableCandidate[]>();
  for (const candidate of candidates) {
    const season = candidate.season ?? 1;
    const identityKey = createMediaIdentityKeys({
      mediaType,
      parsedTitle: candidate.parsedTitle,
      normalizedTitle: candidate.normalizedTitle,
      rawTitle: candidate.rawTitle,
      season,
    })[0] ?? candidate.normalizedTitle;
    const key = `${mediaType}::${identityKey}::${season}`;
    grouped.set(key, [...(grouped.get(key) ?? []), candidate]);
  }
  return grouped;
}

function groupAnimeCandidatesByAlias(mediaType: MediaType, candidates: GroupableCandidate[]) {
  const parent = new Map<string, string>();
  const aliasOwners = new Map<string, string>();

  for (const candidate of candidates) {
    parent.set(candidate.id, candidate.id);
  }

  for (const candidate of candidates) {
    const season = candidate.season ?? 1;
    for (const alias of candidateAliasKeys(candidate)) {
      const key = `${mediaType}::${season}::${alias}`;
      const existing = aliasOwners.get(key);
      if (existing) {
        unionCandidateIds(parent, candidate.id, existing);
      } else {
        aliasOwners.set(key, candidate.id);
      }
    }
  }

  const grouped = new Map<string, GroupableCandidate[]>();
  for (const candidate of candidates) {
    const root = findCandidateRoot(parent, candidate.id);
    grouped.set(root, [...(grouped.get(root) ?? []), candidate]);
  }

  for (const [root, items] of grouped) {
    grouped.set(
      root,
      items.sort((a, b) => a.parsedTitle.localeCompare(b.parsedTitle)),
    );
  }

  return grouped;
}

function candidateAliasKeys(candidate: GroupableCandidate) {
  return createStrongMediaIdentityKeys({
    parsedTitle: candidate.parsedTitle,
    normalizedTitle: candidate.normalizedTitle,
    rawTitle: candidate.rawTitle,
    season: candidate.season ?? 1,
  })
    .map((alias) => alias.trim())
    .filter((alias) => alias.length >= 3);
}

function findCandidateRoot(parent: Map<string, string>, id: string): string {
  const current = parent.get(id) ?? id;
  if (current === id) {
    return current;
  }
  const root = findCandidateRoot(parent, current);
  parent.set(id, root);
  return root;
}

function unionCandidateIds(parent: Map<string, string>, left: string, right: string) {
  const leftRoot = findCandidateRoot(parent, left);
  const rightRoot = findCandidateRoot(parent, right);
  if (leftRoot !== rightRoot) {
    parent.set(rightRoot, leftRoot);
  }
}

function chooseGroupNormalizedTitle(items: GroupableCandidate[]) {
  const cjkTitle = items.find((item) => /[\u3400-\u9fff]/.test(item.normalizedTitle));
  return cjkTitle?.normalizedTitle ?? items[0].normalizedTitle;
}

function chooseGroupDisplayTitle(items: GroupableCandidate[]) {
  const cjkTitle = items.find((item) => /[\u3400-\u9fff]/.test(item.parsedTitle));
  return cjkTitle?.parsedTitle ?? items[0].parsedTitle;
}
