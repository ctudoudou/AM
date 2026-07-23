export type HardwareAccelerationPreference =
  | "auto"
  | "software"
  | "videotoolbox"
  | "nvidia"
  | "qsv"
  | "vaapi";

export type TranscodeBackend =
  | "software"
  | "videotoolbox"
  | "nvidia"
  | "qsv"
  | "vaapi";

export type FfmpegCapabilities = {
  encoders: ReadonlySet<string>;
  hwaccels: ReadonlySet<string>;
  platform: NodeJS.Platform;
  nvidiaDeviceAvailable: boolean;
  vaapiDeviceAvailable: boolean;
};

export type TranscodePlan = {
  backend: TranscodeBackend;
  label: string;
  hardwareAccelerated: boolean;
  inputArgs: string[];
  videoArgs: string[];
};

export type FfmpegProgress = {
  positionSec: number;
  percent: number | null;
  speed: string | null;
};

const forceKeyFramesArgs = [
  "-force_key_frames",
  "expr:gte(t,n_forced*4)",
];

export function parseFfmpegHwaccels(output: string) {
  return new Set(
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[a-z0-9_]+$/i.test(line)),
  );
}

export function parseFfmpegEncoders(output: string) {
  return new Set(
    output
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*[A-Z.]{6}\s+([a-z0-9_]+)\s/i)?.[1] ?? "")
      .filter(Boolean),
  );
}

export function selectTranscodePlans(input: {
  capabilities: FfmpegCapabilities;
  preference: HardwareAccelerationPreference;
  height?: number | null;
  vaapiDevice: string;
}) {
  const plans = availableHardwarePlans(input);
  const requested = input.preference === "auto"
    ? plans
    : plans.filter((plan) => plan.backend === input.preference);

  return [...requested, softwareTranscodePlan()];
}

export function buildHlsFfmpegArgs(input: {
  sourcePath: string;
  playlistPath: string;
  segmentPath: string;
  plan: TranscodePlan | null;
  videoCopy: boolean;
  audioCopy: boolean;
}) {
  const videoArgs = input.videoCopy
    ? ["-c:v", "copy"]
    : input.plan?.videoArgs ?? softwareTranscodePlan().videoArgs;
  const inputArgs = input.videoCopy ? [] : input.plan?.inputArgs ?? [];
  const audioArgs = input.audioCopy
    ? ["-c:a", "copy"]
    : ["-c:a", "aac", "-b:a", "192k"];

  return [
    "-hide_banner",
    "-y",
    "-nostdin",
    ...inputArgs,
    "-i",
    input.sourcePath,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-sn",
    ...videoArgs,
    ...audioArgs,
    "-max_muxing_queue_size",
    "4096",
    "-progress",
    "pipe:1",
    "-nostats",
    "-f",
    "hls",
    "-hls_time",
    "4",
    "-hls_list_size",
    "0",
    "-hls_playlist_type",
    "event",
    "-hls_flags",
    "independent_segments+temp_file",
    "-hls_segment_filename",
    input.segmentPath,
    input.playlistPath,
  ];
}

export function updateFfmpegProgress(
  current: FfmpegProgress,
  line: string,
  durationSec: number | null,
): FfmpegProgress {
  const separator = line.indexOf("=");
  if (separator < 1) {
    return current;
  }
  const key = line.slice(0, separator);
  const value = line.slice(separator + 1).trim();
  let positionSec = current.positionSec;
  let speed = current.speed;

  if (key === "out_time_us" || key === "out_time_ms") {
    const microseconds = Number(value);
    if (Number.isFinite(microseconds) && microseconds >= 0) {
      positionSec = microseconds / 1_000_000;
    }
  } else if (key === "out_time") {
    const parsed = parseFfmpegClock(value);
    if (parsed !== null) {
      positionSec = parsed;
    }
  } else if (key === "speed") {
    speed = value && value !== "N/A" ? value : null;
  }

  return {
    positionSec,
    percent:
      durationSec && durationSec > 0
        ? Math.min(100, Math.max(0, (positionSec / durationSec) * 100))
        : null,
    speed,
  };
}

export function resolvePlaybackDuration(
  sourceDurationSec: number | null | undefined,
  providerDurationSec: number,
) {
  if (sourceDurationSec && Number.isFinite(sourceDurationSec) && sourceDurationSec > 0) {
    return sourceDurationSec;
  }
  return Number.isFinite(providerDurationSec) && providerDurationSec > 0
    ? providerDurationSec
    : 0;
}

export function inferBrowserPlaybackMode(input: {
  filePath: string;
  videoCodec?: string | null;
  audioCodec?: string | null;
  pixelFormat?: string | null;
}) {
  const extension = input.filePath.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
  const videoCodec = input.videoCodec?.toLowerCase();
  const audioCodec = input.audioCodec?.toLowerCase();

  if ([".mp4", ".m4v", ".mov"].includes(extension)) {
    return isBrowserCompatibleH264(videoCodec, input.pixelFormat) &&
      (!audioCodec || ["aac", "mp3"].includes(audioCodec))
      ? "DIRECT"
      : null;
  }
  if (extension === ".webm") {
    return ["vp8", "vp9", "av1"].includes(videoCodec ?? "") &&
      (!audioCodec || ["opus", "vorbis"].includes(audioCodec))
      ? "DIRECT"
      : null;
  }
  return null;
}

export function isBrowserCompatibleH264(
  videoCodec: string | null | undefined,
  pixelFormat: string | null | undefined,
) {
  if (videoCodec?.toLowerCase() !== "h264") {
    return false;
  }
  return !pixelFormat || ["yuv420p", "yuvj420p"].includes(pixelFormat.toLowerCase());
}

function availableHardwarePlans(input: {
  capabilities: FfmpegCapabilities;
  preference: HardwareAccelerationPreference;
  height?: number | null;
  vaapiDevice: string;
}) {
  const { capabilities } = input;
  const bitrate = bitrateForHeight(input.height);
  const plans: TranscodePlan[] = [];

  if (
    capabilities.platform === "darwin" &&
    capabilities.hwaccels.has("videotoolbox") &&
    capabilities.encoders.has("h264_videotoolbox")
  ) {
    plans.push({
      backend: "videotoolbox",
      label: "VideoToolbox",
      hardwareAccelerated: true,
      inputArgs: ["-hwaccel", "videotoolbox"],
      videoArgs: [
        "-c:v",
        "h264_videotoolbox",
        "-profile:v",
        "high",
        "-b:v",
        bitrate.target,
        "-maxrate",
        bitrate.max,
        "-bufsize",
        bitrate.buffer,
        "-pix_fmt",
        "yuv420p",
        ...forceKeyFramesArgs,
      ],
    });
  }

  if (
    capabilities.nvidiaDeviceAvailable &&
    capabilities.hwaccels.has("cuda") &&
    capabilities.encoders.has("h264_nvenc")
  ) {
    plans.push({
      backend: "nvidia",
      label: "NVIDIA NVENC",
      hardwareAccelerated: true,
      inputArgs: ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"],
      videoArgs: [
        "-c:v",
        "h264_nvenc",
        "-preset",
        "p4",
        "-tune",
        "hq",
        "-rc",
        "vbr",
        "-cq",
        "20",
        "-b:v",
        bitrate.target,
        "-maxrate",
        bitrate.max,
        "-bufsize",
        bitrate.buffer,
        "-profile:v",
        "high",
        ...forceKeyFramesArgs,
      ],
    });
  }

  if (
    capabilities.vaapiDeviceAvailable &&
    capabilities.hwaccels.has("qsv") &&
    capabilities.encoders.has("h264_qsv")
  ) {
    plans.push({
      backend: "qsv",
      label: "Intel Quick Sync",
      hardwareAccelerated: true,
      inputArgs: ["-hwaccel", "qsv", "-hwaccel_output_format", "qsv"],
      videoArgs: [
        "-c:v",
        "h264_qsv",
        "-preset",
        "veryfast",
        "-global_quality",
        "20",
        "-look_ahead",
        "0",
        "-profile:v",
        "high",
        ...forceKeyFramesArgs,
      ],
    });
  }

  if (
    capabilities.vaapiDeviceAvailable &&
    capabilities.hwaccels.has("vaapi") &&
    capabilities.encoders.has("h264_vaapi")
  ) {
    plans.push({
      backend: "vaapi",
      label: "VA-API",
      hardwareAccelerated: true,
      inputArgs: [
        "-hwaccel",
        "vaapi",
        "-hwaccel_device",
        input.vaapiDevice,
        "-hwaccel_output_format",
        "vaapi",
      ],
      videoArgs: [
        "-c:v",
        "h264_vaapi",
        "-qp",
        "20",
        "-profile:v",
        "high",
        ...forceKeyFramesArgs,
      ],
    });
  }

  return plans;
}

function softwareTranscodePlan(): TranscodePlan {
  return {
    backend: "software",
    label: "libx264",
    hardwareAccelerated: false,
    inputArgs: [],
    videoArgs: [
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-profile:v",
      "high",
      "-pix_fmt",
      "yuv420p",
      ...forceKeyFramesArgs,
    ],
  };
}

function bitrateForHeight(height?: number | null) {
  if (!height || height <= 720) {
    return { target: "4M", max: "6M", buffer: "8M" };
  }
  if (height <= 1080) {
    return { target: "8M", max: "12M", buffer: "16M" };
  }
  if (height <= 1440) {
    return { target: "14M", max: "20M", buffer: "28M" };
  }
  return { target: "24M", max: "32M", buffer: "48M" };
}

function parseFfmpegClock(value: string) {
  const match = value.match(/^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  if (!match) {
    return null;
  }
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isFinite(seconds) ? seconds : null;
}
