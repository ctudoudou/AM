import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import type { SubtitleTrack } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parseMediaReleaseTitle } from "@/lib/media-parser";
import {
  translateSubtitleCuesWithOpenRouter,
  type SubtitleTranslationTarget,
} from "@/lib/openrouter";
import { getAppSettings } from "@/lib/settings";

const execFileAsync = promisify(execFile);
const subtitleExtensions = new Set([".vtt", ".srt", ".ass", ".ssa"]);
const playableSubtitleFormats = new Set(["vtt", "ass", "ssa"]);
const translatableSubtitleFormats = new Set(["vtt", "srt", "ass", "ssa"]);
const subtitleContentTypes = new Map([
  ["vtt", "text/vtt; charset=utf-8"],
  ["srt", "application/x-subrip; charset=utf-8"],
  ["ass", "text/plain; charset=utf-8"],
  ["ssa", "text/plain; charset=utf-8"],
]);
const subtitleTranslationBatchMaxCues = 60;
const subtitleTranslationBatchMaxCharacters = 6_000;
const subtitleTranslationConcurrency = 2;

export type SubtitleTrackDescriptor = {
  id: string;
  label: string;
  language: string | null;
  format: string;
  kind: string;
  sourceName: string | null;
  isDefault: boolean;
  canPlay: boolean;
  canTranslate: boolean;
  url: string;
};

export type EmbeddedSubtitleStream = {
  index: number;
  codec_name?: string;
  codec_type?: string;
  tags?: {
    language?: string;
    title?: string;
  };
};

type EmbeddedSubtitleProbe = {
  streams?: EmbeddedSubtitleStream[];
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
  const discovered: SubtitleTrack[] = [];

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
  discovered.push(...(await discoverEmbeddedSubtitleTracks({
    mediaFileId,
    episodeId: file.episodeId,
    mediaPath,
    metadataRoot: settings.directories.metadataDir,
  })));

  return {
    discovered: discovered.length,
    tracks: await listSubtitleTracks(mediaFileId),
  };
}

async function discoverEmbeddedSubtitleTracks(input: {
  mediaFileId: string;
  episodeId: string | null;
  mediaPath: string;
  metadataRoot: string;
}) {
  const streams = await probeEmbeddedSubtitleStreams(input.mediaPath).catch(() => []);
  if (streams.length === 0) {
    return [];
  }
  const outputDir = assertInsideRoots(
    path.join(input.metadataRoot, "subtitles", input.mediaFileId),
    [path.resolve(input.metadataRoot)],
  );
  await fs.mkdir(outputDir, { recursive: true });
  const discovered: SubtitleTrack[] = [];

  for (const stream of streams) {
    const format = embeddedSubtitleOutputFormatForCodec(stream.codec_name);
    if (!format) {
      continue;
    }
    const language = inferEmbeddedSubtitleLanguage(stream);
    const label = buildEmbeddedSubtitleLabel(stream, language, format);
    const sourcePath = assertInsideRoots(
      path.join(outputDir, `embedded-${stream.index}.${format}`),
      [path.resolve(input.metadataRoot)],
    );
    const extracted = await extractEmbeddedSubtitleStream({
      mediaPath: input.mediaPath,
      streamIndex: stream.index,
      outputPath: sourcePath,
    });
    if (!extracted) {
      continue;
    }
    const track = await prisma.subtitleTrack.upsert({
      where: {
        mediaFileId_sourcePath: {
          mediaFileId: input.mediaFileId,
          sourcePath,
        },
      },
      create: {
        mediaFileId: input.mediaFileId,
        episodeId: input.episodeId,
        label,
        language,
        format,
        kind: "EMBEDDED",
        sourcePath,
        sourceName: stream.tags?.title ?? `Stream ${stream.index}`,
        isDefault: discovered.length === 0,
      },
      update: {
        episodeId: input.episodeId,
        label,
        language,
        format,
        kind: "EMBEDDED",
        sourceName: stream.tags?.title ?? `Stream ${stream.index}`,
      },
    });
    discovered.push(track);
  }

  return discovered;
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

export async function translateSubtitleTrack(
  subtitleTrackId: string,
  targetLanguage: SubtitleTranslationTarget,
) {
  const settings = await getAppSettings();
  const track = await prisma.subtitleTrack.findUniqueOrThrow({
    where: { id: subtitleTrackId },
    include: {
      mediaFile: {
        include: {
          episode: {
            include: { season: { include: { media: true } } },
          },
        },
      },
    },
  });
  if (!track.mediaFileId || !track.sourcePath) {
    throw new Error("Subtitle track has no local source file.");
  }
  const sourceFormat = track.format.toLowerCase();
  if (!translatableSubtitleFormats.has(sourceFormat)) {
    throw new Error("Selected subtitle format cannot be translated.");
  }
  if (track.language === targetLanguage || track.language === "zh") {
    throw new Error("Selected subtitle track is already Chinese.");
  }

  const sourcePath = assertInsideRoots(track.sourcePath, allowedSubtitleRoots(settings.directories));
  const outputDir = assertInsideRoots(
    path.join(settings.directories.metadataDir, "subtitles", track.mediaFileId),
    [path.resolve(settings.directories.metadataDir)],
  );
  await fs.mkdir(outputDir, { recursive: true });
  const source = await readSubtitleAsWebVtt({
    sourcePath,
    sourceFormat,
    outputDir,
    trackId: track.id,
  });
  const parsed = parseWebVtt(source);
  const translatableCues = parsed.cues
    .map((cue, index) => ({ index, text: cue.text.trim() }))
    .filter((cue) => cue.text.length > 0);
  if (translatableCues.length === 0) {
    throw new Error("Subtitle track has no translatable cues.");
  }

  const batches = buildSubtitleTranslationBatches(translatableCues);
  const translated = new Map<number, string>();
  const translatedBatches = await mapWithConcurrency(
    batches,
    subtitleTranslationConcurrency,
    async (batch) => {
      const translatedBatch = await translateSubtitleCuesWithOpenRouter({
        targetLanguage,
        cues: batch,
        context: {
          title: track.mediaFile?.episode?.season.media.primaryTitle ?? null,
          sourceLanguage: track.language,
        },
      });
      validateTranslatedCueBatch(batch, translatedBatch);
      return translatedBatch;
    },
  );
  for (const translatedBatch of translatedBatches) {
    for (const cue of translatedBatch) {
      translated.set(cue.index, cue.text.trim());
    }
  }

  const output = formatWebVtt({
    cues: parsed.cues.map((cue, index) => ({
      ...cue,
      text: translated.get(index) ?? cue.text,
    })),
  });
  const outputPath = assertInsideRoots(
    path.join(outputDir, `translated-${targetLanguage}-from-${track.id}.vtt`),
    [path.resolve(settings.directories.metadataDir)],
  );
  await writeFileAtomically(outputPath, output);

  const translatedTrack = await prisma.subtitleTrack.upsert({
    where: {
      mediaFileId_sourcePath: {
        mediaFileId: track.mediaFileId,
        sourcePath: outputPath,
      },
    },
    create: {
      mediaFileId: track.mediaFileId,
      episodeId: track.episodeId,
      label: translatedSubtitleLabel(targetLanguage),
      language: targetLanguage,
      format: "vtt",
      kind: "TRANSLATED",
      sourcePath: outputPath,
      sourceName: `${translatedSubtitleLabel(targetLanguage)} from ${track.label}`,
      isDefault: false,
    },
    update: {
      episodeId: track.episodeId,
      label: translatedSubtitleLabel(targetLanguage),
      language: targetLanguage,
      format: "vtt",
      kind: "TRANSLATED",
      sourceName: `${translatedSubtitleLabel(targetLanguage)} from ${track.label}`,
    },
  });

  return {
    track: toSubtitleTrackDescriptor(translatedTrack),
    tracks: await listSubtitleTracks(track.mediaFileId),
  };
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

function translatedSubtitleLabel(targetLanguage: SubtitleTranslationTarget) {
  return targetLanguage === "zh-Hant" ? "繁體中文 · AI translated" : "简体中文 · AI translated";
}

export function buildEmbeddedSubtitleLabel(
  stream: Pick<EmbeddedSubtitleStream, "index" | "tags">,
  language: string | null,
  format: string,
) {
  const title = stream.tags?.title?.trim();
  const languageLabel = language ? languageLabelForCode(language) : null;
  const label = title || languageLabel || `Subtitle ${stream.index}`;
  return `${label} · ${format.toUpperCase()}`;
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
  if (language === "es") {
    return "Español";
  }
  if (language === "pt") {
    return "Português";
  }
  if (language === "fr") {
    return "Français";
  }
  if (language === "de") {
    return "Deutsch";
  }
  if (language === "ar") {
    return "العربية";
  }
  if (language === "it") {
    return "Italiano";
  }
  if (language === "ru") {
    return "Русский";
  }
  return language;
}

type WebVttCue = {
  id: string | null;
  timing: string;
  text: string;
};

export function buildSubtitleTranslationBatches(
  cues: Array<{ index: number; text: string }>,
  options?: { maxCues?: number; maxCharacters?: number },
) {
  const maxCues = options?.maxCues ?? subtitleTranslationBatchMaxCues;
  const maxCharacters = options?.maxCharacters ?? subtitleTranslationBatchMaxCharacters;
  const batches: Array<Array<{ index: number; text: string }>> = [];
  let current: Array<{ index: number; text: string }> = [];
  let currentCharacters = 0;

  for (const cue of cues) {
    const cueCharacters = cue.text.length;
    if (
      current.length > 0 &&
      (current.length >= maxCues || currentCharacters + cueCharacters > maxCharacters)
    ) {
      batches.push(current);
      current = [];
      currentCharacters = 0;
    }
    current.push(cue);
    currentCharacters += cueCharacters;
  }
  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
}

export function parseWebVtt(source: string) {
  const normalized = source
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const cues: WebVttCue[] = [];

  for (const block of blocks) {
    if (/^WEBVTT(?:\s|$)/i.test(block) || /^NOTE(?:\s|$)/i.test(block)) {
      continue;
    }
    const lines = block.split("\n");
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) {
      continue;
    }
    const id = timingIndex > 0 ? lines.slice(0, timingIndex).join("\n").trim() : null;
    const text = lines.slice(timingIndex + 1).join("\n").trim();
    cues.push({
      id: id || null,
      timing: lines[timingIndex].trim(),
      text,
    });
  }

  if (cues.length === 0) {
    throw new Error("WebVTT subtitle track has no cues.");
  }
  return { cues };
}

export function formatWebVtt(input: { cues: WebVttCue[] }) {
  return [
    "WEBVTT",
    "",
    ...input.cues.flatMap((cue) => [
      ...(cue.id ? [cue.id] : []),
      cue.timing,
      cue.text,
      "",
    ]),
  ].join("\n");
}

export function validateTranslatedCueBatch(
  source: Array<{ index: number; text: string }>,
  translated: Array<{ index: number; text: string }>,
) {
  if (source.length !== translated.length) {
    throw new Error("Subtitle translation returned the wrong number of cues.");
  }
  const sourceIndexes = new Set(source.map((cue) => cue.index));
  const translatedIndexes = new Set<number>();
  for (const cue of translated) {
    if (!sourceIndexes.has(cue.index)) {
      throw new Error("Subtitle translation returned an unexpected cue index.");
    }
    if (translatedIndexes.has(cue.index)) {
      throw new Error("Subtitle translation returned a duplicate cue index.");
    }
    translatedIndexes.add(cue.index);
    if (!cue.text.trim()) {
      throw new Error("Subtitle translation returned an empty cue.");
    }
  }
  if (translatedIndexes.size !== sourceIndexes.size) {
    throw new Error("Subtitle translation omitted one or more cues.");
  }
}

async function readSubtitleAsWebVtt(input: {
  sourcePath: string;
  sourceFormat: string;
  outputDir: string;
  trackId: string;
}) {
  if (input.sourceFormat === "vtt") {
    return fs.readFile(input.sourcePath, "utf8");
  }

  const normalizedPath = assertInsideRoots(
    path.join(input.outputDir, `translation-source-${input.trackId}.vtt`),
    [path.resolve(input.outputDir)],
  );
  const sourceStat = await fs.stat(input.sourcePath);
  const normalizedStat = await fs.stat(normalizedPath).catch(() => null);
  if (normalizedStat?.isFile() && normalizedStat.size > 0 && normalizedStat.mtimeMs >= sourceStat.mtimeMs) {
    return fs.readFile(normalizedPath, "utf8");
  }

  const temporaryPath = temporarySiblingPath(normalizedPath);
  await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  try {
    await execFileAsync("ffmpeg", [
      "-hide_banner",
      "-y",
      "-nostdin",
      "-i",
      input.sourcePath,
      "-map",
      "0:0",
      "-c:s",
      "webvtt",
      temporaryPath,
    ]);
    const stat = await fs.stat(temporaryPath);
    if (!stat.isFile() || stat.size === 0) {
      throw new Error("FFmpeg produced an empty WebVTT subtitle.");
    }
    await replaceFile(temporaryPath, normalizedPath);
    return fs.readFile(normalizedPath, "utf8");
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw new Error(
      `Unable to convert ${input.sourceFormat.toUpperCase()} subtitles to WebVTT: ${
        error instanceof Error ? error.message : "FFmpeg failed"
      }`,
    );
  }
}

async function writeFileAtomically(targetPath: string, content: string) {
  const temporaryPath = temporarySiblingPath(targetPath);
  try {
    await fs.writeFile(temporaryPath, content, "utf8");
    await replaceFile(temporaryPath, targetPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function replaceFile(sourcePath: string, targetPath: string) {
  try {
    await fs.rename(sourcePath, targetPath);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : null;
    if (code !== "EEXIST" && code !== "EPERM") {
      throw error;
    }
    await fs.rm(targetPath, { force: true });
    await fs.rename(sourcePath, targetPath);
  }
}

function temporarySiblingPath(targetPath: string) {
  const extension = path.extname(targetPath);
  return path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath, extension)}.tmp-${process.pid}-${randomUUID()}${extension}`,
  );
}

async function mapWithConcurrency<T, TResult>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<TResult>,
) {
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function probeEmbeddedSubtitleStreams(mediaPath: string) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-hide_banner",
    "-v",
    "error",
    "-show_entries",
    "stream=index,codec_type,codec_name:stream_tags=language,title",
    "-of",
    "json",
    mediaPath,
  ]);
  return embeddedSubtitleStreamsFromProbe(stdout);
}

export function embeddedSubtitleStreamsFromProbe(stdout: string) {
  const probe = JSON.parse(stdout) as EmbeddedSubtitleProbe;
  return (probe.streams ?? []).filter(
    (stream) =>
      stream.codec_type === "subtitle" &&
      Number.isInteger(stream.index) &&
      Boolean(subtitleFormatForCodec(stream.codec_name)),
  );
}

async function extractEmbeddedSubtitleStream(input: {
  mediaPath: string;
  streamIndex: number;
  outputPath: string;
}) {
  const extension = path.extname(input.outputPath);
  const temporaryPath = path.join(
    path.dirname(input.outputPath),
    `.${path.basename(input.outputPath, extension)}.tmp-${process.pid}${extension}`,
  );
  await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-y",
    "-i",
    input.mediaPath,
    "-map",
    `0:${input.streamIndex}`,
    "-c:s",
    "webvtt",
    temporaryPath,
  ]).catch(() => undefined);
  const stat = await fs.stat(temporaryPath).catch(() => null);
  if (!stat?.isFile() || stat.size === 0) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    return false;
  }
  await fs.rename(temporaryPath, input.outputPath);
  return true;
}

export function subtitleFormatForCodec(codecName: string | null | undefined) {
  switch (codecName?.toLowerCase()) {
    case "ass":
      return "ass";
    case "ssa":
      return "ssa";
    case "subrip":
      return "srt";
    case "webvtt":
      return "vtt";
    default:
      return null;
  }
}

export function embeddedSubtitleOutputFormatForCodec(codecName: string | null | undefined) {
  return subtitleFormatForCodec(codecName) ? "vtt" : null;
}

export function inferEmbeddedSubtitleLanguage(stream: Pick<EmbeddedSubtitleStream, "tags">) {
  return normalizeSubtitleLanguageCode(stream.tags?.language) ?? inferSubtitleLanguage(stream.tags?.title ?? "");
}

function normalizeSubtitleLanguageCode(language: string | null | undefined) {
  const normalized = language?.trim().toLowerCase();
  if (!normalized || normalized === "und") {
    return null;
  }
  const mapped = iso639ThreeLetterLanguageMap.get(normalized);
  if (mapped) {
    return mapped;
  }
  if (/^[a-z]{2}(?:-[a-z0-9]+)?$/i.test(normalized)) {
    return normalized;
  }
  return null;
}

const iso639ThreeLetterLanguageMap = new Map([
  ["ara", "ar"],
  ["deu", "de"],
  ["ger", "de"],
  ["eng", "en"],
  ["fre", "fr"],
  ["fra", "fr"],
  ["ita", "it"],
  ["jpn", "ja"],
  ["por", "pt"],
  ["rus", "ru"],
  ["spa", "es"],
  ["zho", "zh"],
  ["chi", "zh"],
]);

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
    canTranslate: translatableSubtitleFormats.has(format),
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
