import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { prisma } from "@/lib/db";
import { parseMediaReleaseTitle } from "@/lib/media-parser";
import { getAppSettings } from "@/lib/settings";

const subtitleExtensions = new Set([".vtt", ".srt", ".ass", ".ssa"]);
const playableSubtitleFormats = new Set(["vtt", "srt", "ass", "ssa"]);
const subtitleContentTypes = new Map([
  ["vtt", "text/vtt; charset=utf-8"],
  ["srt", "application/x-subrip; charset=utf-8"],
  ["ass", "text/plain; charset=utf-8"],
  ["ssa", "text/plain; charset=utf-8"],
]);

export type SubtitleTrackDescriptor = {
  id: string;
  label: string;
  language: string | null;
  format: string;
  kind: string;
  sourceName: string | null;
  isDefault: boolean;
  canPlay: boolean;
  url: string;
};

export async function listSubtitleTracks(mediaFileId: string) {
  const tracks = await prisma.subtitleTrack.findMany({
    where: { mediaFileId },
    orderBy: [{ isDefault: "desc" }, { language: "asc" }, { label: "asc" }],
  });
  return tracks.map(toSubtitleTrackDescriptor);
}

export async function discoverSubtitleTracks(mediaFileId: string) {
  const settings = await getAppSettings();
  const file = await prisma.mediaFile.findUniqueOrThrow({
    where: { id: mediaFileId },
    include: { episode: true },
  });
  const mediaPath = assertInsideRoots(file.absolutePath, allowedSubtitleRoots(settings.directories));
  const dir = path.dirname(mediaPath);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const discovered = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const extension = path.extname(entry.name).toLowerCase();
    if (!subtitleExtensions.has(extension)) {
      continue;
    }
    const sourcePath = assertInsideRoots(path.join(dir, entry.name), allowedSubtitleRoots(settings.directories));
    if (!subtitleMatchesMediaFile(entry.name, file)) {
      continue;
    }
    const format = extension.slice(1).toLowerCase();
    const language = inferSubtitleLanguage(entry.name);
    const label = buildSubtitleLabel(entry.name, language, format);
    const track = await prisma.subtitleTrack.upsert({
      where: {
        mediaFileId_sourcePath: {
          mediaFileId,
          sourcePath,
        },
      },
      create: {
        mediaFileId,
        episodeId: file.episodeId,
        label,
        language,
        format,
        kind: "SIDECAR",
        sourcePath,
        sourceName: entry.name,
        isDefault: false,
      },
      update: {
        episodeId: file.episodeId,
        label,
        language,
        format,
        sourceName: entry.name,
      },
    });
    discovered.push(track);
  }

  return {
    discovered: discovered.length,
    tracks: await listSubtitleTracks(mediaFileId),
  };
}

export async function createSubtitleTrackResponse(subtitleTrackId: string) {
  const settings = await getAppSettings();
  const track = await prisma.subtitleTrack.findUniqueOrThrow({
    where: { id: subtitleTrackId },
  });
  if (!track.sourcePath) {
    throw new Error("Subtitle track has no local source path.");
  }
  const filePath = assertInsideRoots(track.sourcePath, allowedSubtitleRoots(settings.directories));
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    throw new Error("Subtitle source is not a file.");
  }
  const format = track.format.toLowerCase();
  const contentType = subtitleContentTypes.get(format) ?? "text/plain; charset=utf-8";
  const stream = createReadStream(filePath);
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    headers: {
      "Cache-Control": "private, max-age=60",
      "Content-Type": contentType,
    },
  });
}

export function inferSubtitleLanguage(fileName: string) {
  const lower = fileName.toLowerCase();
  if (/(简繁|简体.*繁体|chs.*cht|sc.*tc|zh[-_. ]?hans.*zh[-_. ]?hant)/i.test(fileName)) {
    return "zh";
  }
  if (/(简体|简中|chs|gb|sc|zh[-_. ]?hans|zh[-_. ]?cn)/i.test(fileName)) {
    return "zh-Hans";
  }
  if (/(繁体|繁體|繁中|cht|big5|tc|zh[-_. ]?hant|zh[-_. ]?tw|zh[-_. ]?hk)/i.test(fileName)) {
    return "zh-Hant";
  }
  if (/(日语|日語|jpn|japanese|\bja\b)/i.test(fileName)) {
    return "ja";
  }
  if (/(english|\beng\b|\ben\b)/i.test(lower)) {
    return "en";
  }
  return null;
}

export function subtitleMatchesMediaFile(
  subtitleFileName: string,
  mediaFile: {
    originalName: string;
    absolutePath: string;
    episode?: { number: number } | null;
  },
) {
  const subtitleStem = stem(subtitleFileName);
  const mediaStem = stem(mediaFile.originalName || path.basename(mediaFile.absolutePath));
  if (subtitleStem === mediaStem || subtitleStem.startsWith(`${mediaStem}.`) || subtitleStem.startsWith(`${mediaStem} `)) {
    return true;
  }
  const mediaEpisode = mediaFile.episode?.number ?? parseEpisodeNumber(mediaFile.originalName);
  if (!mediaEpisode) {
    return false;
  }
  const subtitleEpisode = parseEpisodeNumber(subtitleFileName);
  return subtitleEpisode === mediaEpisode;
}

function buildSubtitleLabel(fileName: string, language: string | null, format: string) {
  const languageLabel = language ? languageLabelForCode(language) : "Subtitle";
  return `${languageLabel} · ${format.toUpperCase()}`;
}

function languageLabelForCode(language: string) {
  if (language === "zh-Hans") {
    return "简体中文";
  }
  if (language === "zh-Hant") {
    return "繁體中文";
  }
  if (language === "zh") {
    return "简繁中文";
  }
  if (language === "ja") {
    return "日本語";
  }
  if (language === "en") {
    return "English";
  }
  return language;
}

function toSubtitleTrackDescriptor(track: {
  id: string;
  label: string;
  language: string | null;
  format: string;
  kind: string;
  sourceName: string | null;
  isDefault: boolean;
}) {
  const format = track.format.toLowerCase();
  return {
    id: track.id,
    label: track.label,
    language: track.language,
    format,
    kind: track.kind,
    sourceName: track.sourceName,
    isDefault: track.isDefault,
    canPlay: playableSubtitleFormats.has(format),
    url: `/api/subtitles/${track.id}/file`,
  } satisfies SubtitleTrackDescriptor;
}

function parseEpisodeNumber(fileName: string) {
  const parsed = parseMediaReleaseTitle(fileName, "ANIME").episodeNumber;
  if (parsed && parsed > 0) {
    return Math.floor(parsed);
  }
  const match =
    fileName.match(/\bS\d{1,2}E(\d{1,4})\b/i) ??
    fileName.match(/(?:^|[\s._\-[【(])(\d{1,4})(?:v\d+)?(?:[\s._\-\]】)]|$)/);
  const value = Number(match?.[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function stem(fileName: string) {
  return path.basename(fileName, path.extname(fileName)).replace(/\s+/g, " ").trim();
}

function allowedSubtitleRoots(directories: {
  dataRoot: string;
  downloadsDir: string;
  animeLibraryDir: string;
  moviesLibraryDir: string;
  tvLibraryDir: string;
  metadataDir: string;
}) {
  return [
    directories.dataRoot,
    directories.downloadsDir,
    directories.animeLibraryDir,
    directories.moviesLibraryDir,
    directories.tvLibraryDir,
    directories.metadataDir,
  ].map((root) => path.resolve(root));
}

function assertInsideRoots(candidatePath: string, allowedRoots: string[]) {
  const resolved = path.resolve(candidatePath);
  const allowed = allowedRoots.some(
    (root) => resolved === root || resolved.startsWith(`${root}${path.sep}`),
  );
  if (!allowed) {
    throw new Error("Subtitle path is outside configured roots.");
  }
  return resolved;
}
