import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { Readable } from "node:stream";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { prisma } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { getAppSettings } from "@/lib/settings";
import {
  buildHlsFfmpegArgs,
  inferBrowserPlaybackMode,
  isBrowserCompatibleH264,
  parseFfmpegEncoders,
  parseFfmpegHwaccels,
  selectTranscodePlans,
  updateFfmpegProgress,
  type FfmpegCapabilities,
  type FfmpegProgress,
  type TranscodePlan,
} from "@/lib/transcode-profile";

const execFileAsync = promisify(execFile);
const hlsContentTypes = new Map([
  [".m3u8", "application/vnd.apple.mpegurl"],
  [".ts", "video/mp2t"],
  [".m4s", "video/iso.segment"],
  [".mp4", "video/mp4"],
]);
type ActiveTranscode = {
  child: ChildProcess | null;
  cancelled: boolean;
  transcodeDir: string;
  durationSec: number | null;
  fallbackFrom: string[];
  plan: TranscodePlan | null;
  progress: FfmpegProgress;
};

const activeTranscodes = new Map<string, ActiveTranscode>();
const hlsCacheKeys = new Map<string, string>();
let ffmpegCapabilitiesPromise: Promise<FfmpegCapabilities> | null = null;

type ProbeStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
  pix_fmt?: string;
};

type ProbeResult = {
  streams?: ProbeStream[];
  format?: {
    duration?: string;
  };
};

export async function getPlaybackDescriptor(mediaFileId: string) {
  const file = await prisma.mediaFile.findUniqueOrThrow({
    where: { id: mediaFileId },
    include: {
      episode: {
        include: {
          progress: true,
          season: { include: { media: true } },
        },
      },
    },
  });
  const sourcePath = assertInsideRoots(
    file.absolutePath,
    allowedPlaybackRoots((await getAppSettings()).directories),
  );
  const active = activeTranscodes.get(mediaFileId);
  const probe = active ? null : await probeMedia(sourcePath);
  const sourceDurationSec = active?.durationSec ?? (probe ? parseProbeDuration(probe) : null);
  const video = probe?.streams?.find((stream) => stream.codec_type === "video");
  const audio = probe?.streams?.find((stream) => stream.codec_type === "audio");
  const directMode = active
    ? null
    : inferBrowserPlaybackMode({
        filePath: sourcePath,
        videoCodec: video?.codec_name ?? file.videoCodec,
        audioCodec: audio?.codec_name ?? file.audioCodec,
        pixelFormat: video?.pix_fmt,
      });
  const direct = directMode === "DIRECT";
  const hlsOutputExists = !direct && file.transcodePath
    ? await exists(file.transcodePath)
    : false;
  const playbackMode = direct
    ? "DIRECT"
    : file.playbackMode === "HLS_REMUX" || file.playbackMode === "HLS_TRANSCODE"
      ? file.playbackMode
      : null;
  const transcodeStatus = direct
    ? "NOT_REQUIRED"
    : file.transcodeStatus === "NOT_REQUIRED"
      ? "PENDING"
      : file.transcodeStatus === "PROCESSING" && !active
        ? "PENDING"
        : file.transcodeStatus === "READY" && !hlsOutputExists
          ? "PENDING"
          : file.transcodeStatus;
  return {
    mediaFile: file,
    direct,
    playbackMode,
    transcodeStatus,
    sourceDurationSec,
    streamUrl: direct ? `/api/media-files/${file.id}/stream` : null,
    hlsUrl:
      !direct &&
      file.transcodePath &&
      hlsOutputExists &&
      (transcodeStatus === "READY" ||
        transcodeStatus === "PROCESSING")
        ? `/api/media-files/${file.id}/hls/master.m3u8${hlsCacheKeys.has(mediaFileId)
          ? `?session=${hlsCacheKeys.get(mediaFileId)}`
          : ""}`
        : null,
    transcodeProgress: active
      ? {
          ...active.progress,
          backend: active.plan?.backend ?? "remux",
          engine: active.plan?.label ?? "Stream copy",
          hardwareAccelerated: active.plan?.hardwareAccelerated ?? false,
          fallbackFrom: active.fallbackFrom,
        }
      : transcodeStatus === "READY"
        ? {
            positionSec: sourceDurationSec ?? 0,
            percent: 100,
            speed: null,
            backend: playbackMode === "HLS_REMUX" ? "remux" : null,
            engine: playbackMode === "HLS_REMUX" ? "Stream copy" : null,
            hardwareAccelerated: false,
            fallbackFrom: [],
          }
        : null,
    progress: file.episode?.progress[0] ?? null,
  };
}

export async function prepareHlsPlayback(mediaFileId: string) {
  const settings = await getAppSettings();
  const file = await prisma.mediaFile.findUniqueOrThrow({
    where: { id: mediaFileId },
  });
  const sourcePath = assertInsideRoots(file.absolutePath, allowedPlaybackRoots(settings.directories));
  const probe = await probeMedia(sourcePath);
  const video = probe.streams?.find((stream) => stream.codec_type === "video");
  const audio = probe.streams?.find((stream) => stream.codec_type === "audio");
  const directMode = inferBrowserPlaybackMode({
    filePath: sourcePath,
    videoCodec: video?.codec_name ?? file.videoCodec,
    audioCodec: audio?.codec_name ?? file.audioCodec,
    pixelFormat: video?.pix_fmt,
  });

  if (directMode === "DIRECT") {
    hlsCacheKeys.delete(mediaFileId);
    return prisma.mediaFile.update({
      where: { id: mediaFileId },
      data: {
        playbackMode: "DIRECT",
        transcodeStatus: "NOT_REQUIRED",
        transcodeError: null,
      },
    });
  }

  if (file.transcodeStatus === "READY" && file.transcodePath && await exists(file.transcodePath)) {
    return file;
  }
  if (file.transcodeStatus === "PROCESSING" && activeTranscodes.has(mediaFileId)) {
    return file;
  }

  const transcodeDir = assertInsideRoots(
    path.join(settings.directories.transcodesDir, "hls", mediaFileId),
    allowedPlaybackRoots(settings.directories),
  );
  await fs.mkdir(transcodeDir, { recursive: true });
  const resolution =
    video?.width && video.height ? `${video.width}x${video.height}` : file.resolution;
  const videoCopy = isBrowserCompatibleH264(video?.codec_name, video?.pix_fmt);
  const audioCopy = audio?.codec_name === "aac";
  const playbackMode = videoCopy ? "HLS_REMUX" : "HLS_TRANSCODE";
  const playlistPath = path.join(transcodeDir, "master.m3u8");
  const segmentPath = path.join(transcodeDir, "segment-%03d.ts");
  await fs.rm(transcodeDir, { recursive: true, force: true });
  await fs.mkdir(transcodeDir, { recursive: true });

  await prisma.mediaFile.update({
    where: { id: mediaFileId },
    data: {
      playbackMode,
      transcodeStatus: "PROCESSING",
      transcodePath: playlistPath,
      transcodeError: null,
      sourceResolution: resolution,
      videoCodec: video?.codec_name ?? file.videoCodec,
      audioCodec: audio?.codec_name ?? file.audioCodec,
    },
  });
  stopActiveTranscode(mediaFileId);
  hlsCacheKeys.set(mediaFileId, `${Date.now().toString(36)}-0`);
  const plans = videoCopy
    ? [null]
    : selectTranscodePlans({
        capabilities: await detectFfmpegCapabilities(),
        preference: serverEnv.FFMPEG_HWACCEL,
        height: video?.height,
        vaapiDevice: serverEnv.FFMPEG_VAAPI_DEVICE,
      });
  const active: ActiveTranscode = {
    child: null,
    cancelled: false,
    transcodeDir,
    durationSec: parseProbeDuration(probe),
    fallbackFrom: [],
    plan: plans[0],
    progress: { positionSec: 0, percent: 0, speed: null },
  };
  activeTranscodes.set(mediaFileId, active);
  try {
    await startTranscodeAttempt({
      active,
      audioCopy,
      mediaFileId,
      plans,
      playlistPath,
      segmentPath,
      sourcePath,
    });
  } catch (error) {
    activeTranscodes.delete(mediaFileId);
    await markTranscodeFailed(
      mediaFileId,
      error instanceof Error ? error.message : "Unable to start FFmpeg.",
    );
    throw error;
  }

  await waitForFile(playlistPath, 4_000);
  return prisma.mediaFile.findUniqueOrThrow({ where: { id: mediaFileId } });
}

export async function stopHlsPlayback(mediaFileId: string) {
  const settings = await getAppSettings();
  const file = await prisma.mediaFile.findUniqueOrThrow({
    where: { id: mediaFileId },
  });
  if (file.transcodeStatus !== "PROCESSING") {
    return file;
  }

  stopActiveTranscode(mediaFileId);
  hlsCacheKeys.delete(mediaFileId);
  if (file.transcodePath) {
    const transcodeRoot = assertInsideRoots(
      path.dirname(file.transcodePath),
      allowedPlaybackRoots(settings.directories),
    );
    await fs.rm(transcodeRoot, { recursive: true, force: true }).catch(() => undefined);
  }
  return prisma.mediaFile.update({
    where: { id: mediaFileId },
    data: {
      transcodeStatus: "PENDING",
      transcodePath: null,
      transcodeError: "HLS preparation stopped because playback was closed.",
    },
  });
}

export async function createMediaStreamResponse(mediaFileId: string, rangeHeader: string | null) {
  const settings = await getAppSettings();
  const file = await prisma.mediaFile.findUniqueOrThrow({ where: { id: mediaFileId } });
  const filePath = assertInsideRoots(file.absolutePath, allowedPlaybackRoots(settings.directories));
  const stat = await fs.stat(filePath);
  const size = stat.size;
  const range = parseRange(rangeHeader, size);

  if (range) {
    const stream = createReadStream(filePath, { start: range.start, end: range.end });
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      status: 206,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": String(range.end - range.start + 1),
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        "Content-Type": contentTypeForPath(filePath),
      },
    });
  }

  const stream = createReadStream(filePath);
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    headers: {
      "Accept-Ranges": "bytes",
      "Content-Length": String(size),
      "Content-Type": contentTypeForPath(filePath),
    },
  });
}

export async function createHlsAssetResponse(mediaFileId: string, hlsPath: string[]) {
  const settings = await getAppSettings();
  const file = await prisma.mediaFile.findUniqueOrThrow({ where: { id: mediaFileId } });
  if (!["READY", "PROCESSING"].includes(file.transcodeStatus) || !file.transcodePath) {
    return new Response("HLS is not ready", { status: 409 });
  }

  const transcodeRoot = assertInsideRoots(
    path.dirname(file.transcodePath),
    allowedPlaybackRoots(settings.directories),
  );
  const assetPath = assertInsideRoots(
    path.join(transcodeRoot, ...hlsPath),
    [transcodeRoot],
  );
  if (!(await exists(assetPath))) {
    return new Response("HLS asset is not ready", { status: 404 });
  }
  const stream = createReadStream(assetPath);
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": hlsContentTypes.get(path.extname(assetPath)) ?? "application/octet-stream",
      "Cache-Control":
        file.transcodeStatus === "READY" && path.extname(assetPath) !== ".m3u8"
          ? "public, max-age=31536000, immutable"
          : "no-store",
    },
  });
}

function stopActiveTranscode(mediaFileId: string) {
  const active = activeTranscodes.get(mediaFileId);
  if (!active) {
    return;
  }
  activeTranscodes.delete(mediaFileId);
  active.cancelled = true;
  active.child?.kill("SIGTERM");
  setTimeout(() => {
    if (active.child && !active.child.killed) {
      active.child.kill("SIGKILL");
    }
  }, 2_000);
}

async function startTranscodeAttempt(input: {
  active: ActiveTranscode;
  audioCopy: boolean;
  mediaFileId: string;
  plans: Array<TranscodePlan | null>;
  playlistPath: string;
  segmentPath: string;
  sourcePath: string;
}, planIndex = 0): Promise<void> {
  const plan = input.plans[planIndex] ?? null;
  const cacheKey = hlsCacheKeys.get(input.mediaFileId)?.split("-")[0] ?? Date.now().toString(36);
  hlsCacheKeys.set(input.mediaFileId, `${cacheKey}-${planIndex}`);
  input.active.plan = plan;
  input.active.progress = { positionSec: 0, percent: 0, speed: null };
  await fs.rm(input.active.transcodeDir, { recursive: true, force: true });
  await fs.mkdir(input.active.transcodeDir, { recursive: true });

  const child = spawn("ffmpeg", buildHlsFfmpegArgs({
    sourcePath: input.sourcePath,
    playlistPath: input.playlistPath,
    segmentPath: input.segmentPath,
    plan,
    videoCopy: plan === null,
    audioCopy: input.audioCopy,
  }), {
    stdio: ["ignore", "pipe", "pipe"],
  });
  input.active.child = child;
  const stderr: string[] = [];
  let progressBuffer = "";

  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    progressBuffer += chunk;
    const lines = progressBuffer.split(/\r?\n/);
    progressBuffer = lines.pop() ?? "";
    for (const line of lines) {
      input.active.progress = updateFfmpegProgress(
        input.active.progress,
        line,
        input.active.durationSec,
      );
    }
  });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderr.push(chunk);
    while (stderr.join("").length > 8_000) {
      stderr.shift();
    }
  });
  child.on("error", (error) => {
    stderr.push(error.message);
  });
  child.on("close", async (code) => {
    if (input.active.cancelled || activeTranscodes.get(input.mediaFileId) !== input.active) {
      return;
    }
    if (code !== 0 && planIndex + 1 < input.plans.length) {
      input.active.fallbackFrom.push(plan?.label ?? "Stream copy");
      try {
        await startTranscodeAttempt(input, planIndex + 1);
      } catch (error) {
        activeTranscodes.delete(input.mediaFileId);
        await markTranscodeFailed(
          input.mediaFileId,
          error instanceof Error ? error.message : "Unable to start FFmpeg fallback.",
        );
      }
      return;
    }

    await prisma.mediaFile.update({
      where: { id: input.mediaFileId },
      data:
        code === 0
          ? {
              transcodeStatus: "READY",
              transcodeError: null,
              transcodedAt: new Date(),
            }
          : {
              transcodeStatus: "FAILED",
              transcodeError: stderr.join("").slice(-4_000) || `ffmpeg exited with ${code}`,
          },
    }).catch(() => undefined);
    activeTranscodes.delete(input.mediaFileId);
  });
}

async function markTranscodeFailed(mediaFileId: string, message: string) {
  await prisma.mediaFile.update({
    where: { id: mediaFileId },
    data: {
      transcodeStatus: "FAILED",
      transcodeError: message.slice(-4_000),
    },
  }).catch(() => undefined);
}

async function probeMedia(filePath: string): Promise<ProbeResult> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      filePath,
    ]);
    return JSON.parse(stdout) as ProbeResult;
  } catch {
    return {};
  }
}

function parseProbeDuration(probe: ProbeResult) {
  const duration = Math.max(
    Number(probe.format?.duration) || 0,
    ...(probe.streams ?? []).map((stream) => Number(stream.duration) || 0),
  );
  return Number.isFinite(duration) && duration > 0
    ? Math.round(duration * 1_000) / 1_000
    : null;
}

async function detectFfmpegCapabilities(): Promise<FfmpegCapabilities> {
  ffmpegCapabilitiesPromise ??= Promise.all([
    execFileAsync("ffmpeg", ["-hide_banner", "-encoders"], { maxBuffer: 2_000_000 })
      .then(({ stdout }) => parseFfmpegEncoders(stdout))
      .catch(() => new Set<string>()),
    execFileAsync("ffmpeg", ["-hide_banner", "-hwaccels"], { maxBuffer: 200_000 })
      .then(({ stdout }) => parseFfmpegHwaccels(stdout))
      .catch(() => new Set<string>()),
    exists(serverEnv.FFMPEG_VAAPI_DEVICE),
    Promise.all([exists("/dev/nvidia0"), exists("/dev/nvidiactl")]).then((results) =>
      results.some(Boolean),
    ),
  ]).then(([encoders, hwaccels, vaapiDeviceAvailable, nvidiaDeviceAvailable]) => ({
    encoders,
    hwaccels,
    platform: process.platform,
    nvidiaDeviceAvailable,
    vaapiDeviceAvailable,
  }));
  return ffmpegCapabilitiesPromise;
}

async function exists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function waitForFile(targetPath: string, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await exists(targetPath)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function parseRange(rangeHeader: string | null, size: number) {
  if (!rangeHeader?.startsWith("bytes=")) {
    return null;
  }
  const [startValue, endValue] = rangeHeader.replace("bytes=", "").split("-");
  const start = Number(startValue);
  const end = endValue ? Number(endValue) : size - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || end >= size || start > end) {
    return null;
  }
  return { start, end };
}

function contentTypeForPath(filePath: string) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".mp4":
    case ".m4v":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mov":
      return "video/quicktime";
    default:
      return "application/octet-stream";
  }
}

function allowedPlaybackRoots(directories: {
  dataRoot: string;
  downloadsDir: string;
  stagingDir: string;
  animeLibraryDir: string;
  moviesLibraryDir: string;
  tvLibraryDir: string;
  metadataDir: string;
  transcodesDir: string;
}) {
  return [
    directories.dataRoot,
    directories.downloadsDir,
    directories.stagingDir,
    directories.animeLibraryDir,
    directories.moviesLibraryDir,
    directories.tvLibraryDir,
    directories.metadataDir,
    directories.transcodesDir,
  ].map((root) => path.resolve(root));
}

function assertInsideRoots(candidatePath: string, roots: string[]) {
  const resolved = path.resolve(candidatePath);
  const allowed = roots.some(
    (root) => resolved === root || resolved.startsWith(`${root}${path.sep}`),
  );
  if (!allowed) {
    throw new Error(`Path is outside configured Kura roots: ${candidatePath}`);
  }
  return resolved;
}
