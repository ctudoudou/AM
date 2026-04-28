import path from "node:path";
import { prisma } from "@/lib/db";
import { scoreMetadataRelevance, type MetadataMatch } from "@/lib/metadata";

export type AnimeLibraryAuditIssue = {
  mediaId: string;
  primaryTitle: string;
  originalTitle: string | null;
  posterUrl: string | null;
  severity: "HIGH" | "MEDIUM";
  issue: "TITLE_EPISODE_MISMATCH" | "MISSING_POSTER";
  reason: string;
  evidence: string[];
  suggestedTitle: string | null;
  episodeCount: number;
  fileCount: number;
};

type AuditMediaInput = {
  id: string;
  primaryTitle: string;
  originalTitle?: string | null;
  posterUrl?: string | null;
  seasons: Array<{
    episodes: Array<{
      title?: string | null;
      files: Array<{
        originalName: string;
        absolutePath: string;
      }>;
    }>;
  }>;
};

export async function auditAnimeLibrary() {
  const titles = await prisma.mediaTitle.findMany({
    where: { type: "ANIME" },
    orderBy: { updatedAt: "desc" },
    include: {
      seasons: {
        include: {
          episodes: {
            include: {
              files: {
                select: {
                  originalName: true,
                  absolutePath: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const issues = titles.flatMap(auditAnimeTitleRecord);
  return {
    checked: titles.length,
    issues,
  };
}

export function auditAnimeTitleRecord(media: AuditMediaInput): AnimeLibraryAuditIssue[] {
  const episodes = media.seasons.flatMap((season) => season.episodes);
  const files = episodes.flatMap((episode) => episode.files);
  const issues: AnimeLibraryAuditIssue[] = [];
  const episodeTitles = episodes.map((episode) => episode.title).filter(isUsefulTitle);
  const strongestEpisodeTitle = mostCommonTitle(episodeTitles);

  if (episodeTitles.length > 0) {
    const bestEpisodeScore = Math.max(
      ...episodeTitles.map((title) => scoreTitleRelation(media.primaryTitle, title)),
      media.originalTitle
        ? Math.max(...episodeTitles.map((title) => scoreTitleRelation(media.originalTitle ?? "", title)))
        : 0,
    );

    if (bestEpisodeScore < 0.48) {
      issues.push({
        mediaId: media.id,
        primaryTitle: media.primaryTitle,
        originalTitle: media.originalTitle ?? null,
        posterUrl: media.posterUrl ?? null,
        severity: "HIGH",
        issue: "TITLE_EPISODE_MISMATCH",
        reason: "Library title and archived episode titles look unrelated.",
        evidence: [
          `Library title: ${media.primaryTitle}`,
          `Episode title: ${strongestEpisodeTitle ?? episodeTitles[0]}`,
          ...files.slice(0, 2).map((file) => `File: ${path.basename(file.absolutePath || file.originalName)}`),
        ],
        suggestedTitle: strongestEpisodeTitle,
        episodeCount: episodes.length,
        fileCount: files.length,
      });
    }
  }

  if (!media.posterUrl && files.length > 0) {
    issues.push({
      mediaId: media.id,
      primaryTitle: media.primaryTitle,
      originalTitle: media.originalTitle ?? null,
      posterUrl: null,
      severity: "MEDIUM",
      issue: "MISSING_POSTER",
      reason: "Archived title has playable files but no cover art.",
      evidence: [`Library title: ${media.primaryTitle}`],
      suggestedTitle: strongestEpisodeTitle,
      episodeCount: episodes.length,
      fileCount: files.length,
    });
  }

  return issues;
}

function scoreTitleRelation(left: string, right: string) {
  if (!left.trim() || !right.trim()) {
    return 0;
  }
  const result: MetadataMatch = {
    provider: "fallback",
    externalId: "audit",
    title: right,
    score: 1,
    raw: {
      title: right,
    },
  };
  return scoreMetadataRelevance(left, result);
}

function mostCommonTitle(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0] ?? null;
}

function isUsefulTitle(value: string | null | undefined): value is string {
  const title = value?.trim();
  return Boolean(title && title.length >= 3 && title.toLowerCase() !== "unknown");
}
