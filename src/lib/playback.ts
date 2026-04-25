import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { prisma } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";

const execFileAsync = promisify(execFile);
const directPlayExtensions = new Set([".mp4", ".m4v", ".webm", ".mov"]);
const hlsContentTypes = new Map([
  [".m3u8", "application/vnd.apple.mpegurl"],
  [".ts", "video/mp2t"],
  [".m4s", "video/iso.segment"],
  [".mp4", "video/mp4"],
]);

type ProbeStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
};

type ProbeResult = {
  streams?: ProbeStream[];
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
  const playbackMode = file.playbackMode ?? inferDirectPlayback(file.absolutePath);
  const direct = playbackMode === "DIRECT";

  return {
    mediaFile: file,
    direct,
    playbackMode,
    transcodeStatus: direct ? "NOT_REQUIRED" : file.transcodeStatus,
    streamUrl: direct ? `/api/media-files/${file.id}/stream` : null,
    hlsUrl:
      !direct && file.transcodeStatus === "READY"
        ? `/api/media-files/${file.id}/hls/master.m3u8`
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
  const directMode = inferDirectPlayback(sourcePath);

  if (directMode === "DIRECT") {
    return prisma.mediaFile.update({
      where: { id: mediaFileId },
      data: {
        playbackMode: "DIRECT",
        transcodeStatus: "NOT_REQUIRED",
        transcodeError: null,
      },
    });
  }

  if (file.transcodeStatus === "PROCESSING" || file.transcodeStatus === "READY") {
    return file;
  }

  const transcodeDir = assertInsideRoots(
    path.join(settings.directories.transcodesDir, "hls", mediaFileId),
    allowedPlaybackRoots(settings.directories),
  );
  await fs.mkdir(transcodeDir, { recursive: true });
  const probe = await probeMedia(sourcePath);
  const video = probe.streams?.find((stream) => stream.codec_type === "video");
  const audio = probe.streams?.find((stream) => stream.codec_type === "audio");
  const resolution =
    video?.width && video.height ? `${video.width}x${video.height}` : file.resolution;
  const videoCopy = video?.codec_name === "h264";
  const audioCopy = audio?.codec_name === "aac";
  const playbackMode = videoCopy ? "HLS_REMUX" : "HLS_TRANSCODE";
  const playlistPath = path.join(transcodeDir, "master.m3u8");
  const segmentPath = path.join(transcodeDir, "segment-%03d.ts");

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

  const codecArgs = videoCopy
    ? ["-c:v", "copy"]
    : [
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-profile:v",
        "high",
        "-pix_fmt",
        "yuv420p",
      ];
  const audioArgs = audioCopy ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "192k"];
  const args = [
    "-hide_banner",
    "-y",
    "-i",
    sourcePath,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-sn",
    ...codecArgs,
    ...audioArgs,
    "-f",
    "hls",
    "-hls_time",
    "6",
    "-hls_playlist_type",
    "vod",
    "-hls_segment_filename",
    segmentPath,
    playlistPath,
  ];

  const child = spawn("ffmpeg", args, {
    stdio: ["ignore", "ignore", "pipe"],
  });
  const stderr: string[] = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr.push(chunk);
    if (stderr.join("").length > 8_000) {
      stderr.shift();
    }
  });
  child.on("close", async (code) => {
    await prisma.mediaFile.update({
      where: { id: mediaFileId },
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
  });

  return prisma.mediaFile.findUniqueOrThrow({ where: { id: mediaFileId } });
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
  if (file.transcodeStatus !== "READY" || !file.transcodePath) {
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
  const stream = createReadStream(assetPath);
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": hlsContentTypes.get(path.extname(assetPath)) ?? "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

async function probeMedia(filePath: string): Promise<ProbeResult> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_streams",
      "-of",
      "json",
      filePath,
    ]);
    return JSON.parse(stdout) as ProbeResult;
  } catch {
    return {};
  }
}

function inferDirectPlayback(filePath: string) {
  return directPlayExtensions.has(path.extname(filePath).toLowerCase()) ? "DIRECT" : null;
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
