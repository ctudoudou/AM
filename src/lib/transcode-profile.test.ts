import { describe, expect, it } from "vitest";
import {
  buildHlsFfmpegArgs,
  inferBrowserPlaybackMode,
  isBrowserCompatibleH264,
  parseFfmpegEncoders,
  parseFfmpegHwaccels,
  resolvePlaybackDuration,
  selectTranscodePlans,
  updateFfmpegProgress,
  type FfmpegProgress,
} from "./transcode-profile";

describe("transcode profiles", () => {
  it("prefers available VideoToolbox acceleration and retains a software fallback", () => {
    const plans = selectTranscodePlans({
      capabilities: {
        encoders: new Set(["h264_videotoolbox", "libx264"]),
        hwaccels: new Set(["videotoolbox"]),
        platform: "darwin",
        nvidiaDeviceAvailable: false,
        vaapiDeviceAvailable: false,
      },
      preference: "auto",
      height: 1080,
      vaapiDevice: "/dev/dri/renderD128",
    });

    expect(plans.map((plan) => plan.backend)).toEqual(["videotoolbox", "software"]);
    expect(plans[0].inputArgs).toEqual(["-hwaccel", "videotoolbox"]);
  });

  it("uses software only when a forced hardware backend is unavailable", () => {
    const plans = selectTranscodePlans({
      capabilities: {
        encoders: new Set(["libx264"]),
        hwaccels: new Set(),
        platform: "linux",
        nvidiaDeviceAvailable: false,
        vaapiDeviceAvailable: false,
      },
      preference: "vaapi",
      height: 2160,
      vaapiDevice: "/dev/dri/renderD128",
    });

    expect(plans.map((plan) => plan.backend)).toEqual(["software"]);
  });

  it("builds progressive HLS output with FFmpeg telemetry enabled", () => {
    const args = buildHlsFfmpegArgs({
      sourcePath: "/data/source.mkv",
      playlistPath: "/data/transcodes/master.m3u8",
      segmentPath: "/data/transcodes/segment-%03d.ts",
      plan: null,
      videoCopy: true,
      audioCopy: false,
    });

    expect(args).toContain("pipe:1");
    expect(args).toContain("event");
    expect(args).toContain("independent_segments+temp_file");
    expect(args.slice(args.indexOf("-c:v"), args.indexOf("-c:v") + 2)).toEqual(["-c:v", "copy"]);
  });
});

describe("transcode progress", () => {
  it("parses FFmpeg microsecond progress against the source duration", () => {
    let progress: FfmpegProgress = { positionSec: 0, percent: 0, speed: null };
    progress = updateFfmpegProgress(progress, "out_time_us=30000000", 120);
    progress = updateFfmpegProgress(progress, "speed=2.5x", 120);

    expect(progress).toEqual({
      positionSec: 30,
      percent: 25,
      speed: "2.5x",
    });
  });

  it("keeps the real source duration while a growing HLS playlist reports a shorter duration", () => {
    expect(resolvePlaybackDuration(1_440, 24)).toBe(1_440);
    expect(resolvePlaybackDuration(null, 24)).toBe(24);
  });
});

describe("browser playback compatibility", () => {
  it("does not direct-play an MP4 merely because its container is supported", () => {
    expect(
      inferBrowserPlaybackMode({
        filePath: "/data/movie.mp4",
        videoCodec: "hevc",
        audioCodec: "aac",
      }),
    ).toBeNull();
    expect(
      inferBrowserPlaybackMode({
        filePath: "/data/movie.mp4",
        videoCodec: "h264",
        audioCodec: "aac",
      }),
    ).toBe("DIRECT");
  });

  it("transcodes H.264 High 10 instead of remuxing an unsupported browser profile", () => {
    expect(isBrowserCompatibleH264("h264", "yuv420p10le")).toBe(false);
    expect(isBrowserCompatibleH264("h264", "yuv420p")).toBe(true);
  });
});

describe("FFmpeg capability parsing", () => {
  it("extracts capability names from FFmpeg list output", () => {
    expect(parseFfmpegHwaccels("Hardware acceleration methods:\nvaapi\nqsv\n")).toEqual(
      new Set(["vaapi", "qsv"]),
    );
    expect(
      parseFfmpegEncoders(" V....D h264_nvenc NVIDIA NVENC H.264 encoder (codec h264)\n"),
    ).toEqual(new Set(["h264_nvenc"]));
  });
});
