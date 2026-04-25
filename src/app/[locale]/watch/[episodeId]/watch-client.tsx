"use client";

import Hls from "hls.js";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FastForward,
  ListVideo,
  Loader2,
  Maximize,
  Pause,
  Play,
  RefreshCw,
  Rewind,
  RotateCcw,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { getMessages } from "@/messages";
import type { Locale } from "@/lib/i18n";

type WatchMediaFile = {
  id: string;
  originalName: string;
  sourceResolution?: string | null;
  resolution?: string | null;
  videoCodec?: string | null;
  audioCodec?: string | null;
  subtitleGroup?: string | null;
  playbackMode?: "DIRECT" | "HLS_REMUX" | "HLS_TRANSCODE" | null;
  transcodeStatus?: "NOT_REQUIRED" | "PENDING" | "PROCESSING" | "READY" | "FAILED";
  transcodeError?: string | null;
};

type WatchEpisode = {
  id: string;
  number: number;
  title?: string | null;
  seasonNumber: number;
  progress?: { positionSec: number; durationSec?: number | null; completed: boolean } | null;
  files: WatchMediaFile[];
};

type EpisodeLink = {
  id: string;
  number: number;
  title?: string | null;
  seasonNumber: number;
};

type PlaybackDescriptor = {
  direct: boolean;
  playbackMode: "DIRECT" | "HLS_REMUX" | "HLS_TRANSCODE" | null;
  transcodeStatus: "NOT_REQUIRED" | "PENDING" | "PROCESSING" | "READY" | "FAILED";
  sourceDurationSec?: number | null;
  streamUrl?: string | null;
  hlsUrl?: string | null;
  mediaFile: WatchMediaFile;
};

export function WatchClient({
  currentEpisode,
  episodeId,
  episodes,
  initialPositionSec,
  locale,
  mediaFileId,
  nextEpisode,
  previousEpisode,
}: {
  currentEpisode: EpisodeLink;
  episodeId: string;
  episodes: WatchEpisode[];
  initialPositionSec: number;
  locale: Locale;
  mediaFileId: string;
  nextEpisode: EpisodeLink | null;
  previousEpisode: EpisodeLink | null;
}) {
  const t = getMessages(locale);
  const playerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const descriptorRef = useRef<PlaybackDescriptor | null>(null);
  const [descriptor, setDescriptor] = useState<PlaybackDescriptor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(initialPositionSec);
  const [duration, setDuration] = useState(0);
  const [bufferedUntil, setBufferedUntil] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [muted, setMuted] = useState(false);
  const [volume, setVolumeState] = useState(1);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [nativeControls, setNativeControls] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [ended, setEnded] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/media-files/${mediaFileId}/playback`);
      if (!response.ok) {
        throw new Error(t.playbackLoadError);
      }
      const body = (await response.json()) as PlaybackDescriptor;
      if (body.sourceDurationSec && body.sourceDurationSec > 0) {
        setDuration(body.sourceDurationSec);
      }
      setDescriptor(body);
      descriptorRef.current = body;
      setError("");
      return body;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t.playbackLoadError);
      return null;
    } finally {
      setLoading(false);
    }
  }, [mediaFileId, t.playbackLoadError]);

  const prepareHls = useCallback(async () => {
    setError("");
    const response = await fetch(`/api/media-files/${mediaFileId}/transcode`, {
      method: "POST",
    });
    if (!response.ok) {
      setError(t.transcodeStartError);
      return;
    }
    await load();
  }, [load, mediaFileId, t.transcodeStartError]);

  const stopHls = useCallback(() => {
    const current = descriptorRef.current;
    if (current?.direct || current?.transcodeStatus !== "PROCESSING") {
      return;
    }
    void fetch(`/api/media-files/${mediaFileId}/transcode`, {
      method: "DELETE",
      keepalive: true,
    }).catch(() => undefined);
  }, [mediaFileId]);

  const saveProgress = useCallback(async () => {
    const video = videoRef.current;
    if (!video || Number.isNaN(video.currentTime)) {
      return;
    }
    await fetch("/api/watch-progress", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        episodeId,
        positionSec: Math.floor(video.currentTime),
        durationSec: Number.isFinite(video.duration) ? Math.floor(video.duration) : undefined,
      }),
    }).catch(() => undefined);
  }, [episodeId]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  }, []);

  const seekBy = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    const seekLimit = seekableLimit(video, duration);
    video.currentTime = Math.min(Math.max(video.currentTime + seconds, 0), seekLimit);
    setCurrentTime(video.currentTime);
  }, [duration]);

  const seekTo = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    const nextTime = Math.min(Math.max(seconds, 0), seekableLimit(video, duration));
    video.currentTime = nextTime;
    setCurrentTime(nextTime);
  }, [duration]);

  const setVolume = useCallback((nextVolume: number) => {
    const video = videoRef.current;
    const normalized = Math.min(Math.max(nextVolume, 0), 1);
    setVolumeState(normalized);
    if (video) {
      video.volume = normalized;
      video.muted = normalized === 0;
    }
    setMuted(normalized === 0);
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    video.muted = !video.muted;
    setMuted(video.muted);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const player = playerRef.current;
    if (!player) {
      return;
    }
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void player.requestFullscreen();
    }
  }, []);

  const changePlaybackRate = useCallback((rate: number) => {
    const video = videoRef.current;
    setPlaybackRate(rate);
    if (video) {
      video.playbackRate = rate;
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  useEffect(() => {
    descriptorRef.current = descriptor;
  }, [descriptor]);

  useEffect(() => {
    const stopOnPageHide = () => stopHls();
    window.addEventListener("pagehide", stopOnPageHide);
    return () => {
      window.removeEventListener("pagehide", stopOnPageHide);
      stopHls();
    };
  }, [stopHls]);

  useEffect(() => {
    if (!descriptor || descriptor.direct || descriptor.hlsUrl) {
      return;
    }
    if (descriptor.transcodeStatus === "PENDING" || descriptor.transcodeStatus === "FAILED") {
      const timeout = window.setTimeout(() => {
        void prepareHls();
      }, 0);
      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [descriptor, prepareHls]);

  useEffect(() => {
    if (!descriptor || descriptor.direct || descriptor.transcodeStatus !== "PROCESSING") {
      return;
    }
    const timer = window.setInterval(() => {
      void load();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [descriptor, load]);

  const streamUrl = descriptor?.streamUrl ?? null;
  const hlsUrl = descriptor?.hlsUrl ?? null;
  const sourceDurationSec = descriptor?.sourceDurationSec ?? null;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    const sourceUrl = streamUrl ?? hlsUrl;
    if (!sourceUrl) {
      return;
    }

    let hls: Hls | null = null;
    if (hlsUrl && Hls.isSupported()) {
      hls = new Hls({
        backBufferLength: 30,
        enableWorker: true,
        startFragPrefetch: true,
      });
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
    } else {
      video.src = sourceUrl;
    }

    const restore = () => {
      if (initialPositionSec > 0 && video.duration > initialPositionSec) {
        video.currentTime = initialPositionSec;
        setCurrentTime(initialPositionSec);
      }
      const sourceDuration = sourceDurationSec ?? 0;
      setDuration(sourceDuration || (Number.isFinite(video.duration) ? video.duration : 0));
    };
    video.addEventListener("loadedmetadata", restore, { once: true });

    return () => {
      hls?.destroy();
      video.removeEventListener("loadedmetadata", restore);
      video.removeAttribute("src");
      video.load();
    };
  }, [hlsUrl, initialPositionSec, sourceDurationSec, streamUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    video.volume = volume;
    video.muted = muted;
    video.playbackRate = playbackRate;

    const handlePlay = () => {
      setIsPlaying(true);
      setEnded(false);
    };
    const handlePause = () => setIsPlaying(false);
    const updateBuffered = () => setBufferedUntil(bufferedEnd(video));
    const handleTime = () => {
      setCurrentTime(video.currentTime);
      updateBuffered();
    };
    const handleDuration = () => {
      const sourceDuration = descriptorRef.current?.sourceDurationSec ?? 0;
      setDuration(sourceDuration || (Number.isFinite(video.duration) ? video.duration : 0));
      updateBuffered();
    };
    const handleEnded = () => {
      setEnded(true);
      setIsPlaying(false);
      setControlsVisible(true);
      void saveProgress();
    };
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("timeupdate", handleTime);
    video.addEventListener("progress", updateBuffered);
    video.addEventListener("durationchange", handleDuration);
    video.addEventListener("ended", handleEnded);
    return () => {
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("timeupdate", handleTime);
      video.removeEventListener("progress", updateBuffered);
      video.removeEventListener("durationchange", handleDuration);
      video.removeEventListener("ended", handleEnded);
    };
  }, [muted, playbackRate, saveProgress, volume]);

  useEffect(() => {
    if (!isPlaying || !controlsVisible || nativeControls) {
      return;
    }
    const timeout = window.setTimeout(() => setControlsVisible(false), 2600);
    return () => window.clearTimeout(timeout);
  }, [controlsVisible, isPlaying, nativeControls]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        togglePlay();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        seekBy(-10);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        seekBy(10);
      } else if (event.key.toLowerCase() === "m") {
        toggleMute();
      } else if (event.key.toLowerCase() === "f") {
        toggleFullscreen();
      }
      setControlsVisible(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [seekBy, toggleFullscreen, toggleMute, togglePlay]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void saveProgress();
    }, 10_000);
    const flush = () => {
      void saveProgress();
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [saveProgress]);

  if (loading) {
    return (
      <div className="watch-state">
        <Loader2 size={18} />
        {t.loading}
      </div>
    );
  }

  const sourceReady = Boolean(descriptor?.streamUrl || descriptor?.hlsUrl);
  const processingHls = descriptor?.transcodeStatus === "PROCESSING";
  const seekMax =
    processingHls && bufferedUntil > 0
      ? Math.max(currentTime, Math.min(duration || bufferedUntil, bufferedUntil))
      : duration;
  const progressPercent = seekMax > 0 ? (currentTime / seekMax) * 100 : 0;

  return (
    <div className={`watch-stage ${panelOpen ? "panel-open" : ""}`}>
      <div className="watch-player-shell">
        <div
          className="watch-player"
          onMouseMove={() => setControlsVisible(true)}
          ref={playerRef}
        >
          {sourceReady ? (
            <>
              <video
                controls={nativeControls}
                onPause={() => void saveProgress()}
                playsInline
                ref={videoRef}
              />
              {ended ? (
                <div className="watch-ended">
                  <strong>{t.playbackEnded}</strong>
                  <div>
                    <button onClick={() => {
                      seekTo(0);
                      void videoRef.current?.play();
                    }} type="button">
                      <RotateCcw size={14} />
                      {t.replay}
                    </button>
                    {nextEpisode ? (
                      <a href={`/${locale}/watch/${nextEpisode.id}`}>
                        <SkipForward size={14} />
                        {t.nextEpisode}
                      </a>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {!nativeControls ? (
                <div className={`watch-controls ${controlsVisible || !isPlaying ? "visible" : ""}`}>
                  <input
                    aria-label={t.seek}
                    max={seekMax || 0}
                    min={0}
                    onChange={(event) => seekTo(Number(event.target.value))}
                    step={1}
                    style={{ backgroundSize: `${progressPercent}% 100%` }}
                    type="range"
                    value={Math.min(currentTime, seekMax || currentTime)}
                  />
                  <div className="watch-control-row">
                    <div className="watch-control-cluster">
                      <button aria-label={t.playPause} onClick={togglePlay} type="button">
                        {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                      </button>
                      <button aria-label={t.rewind10} onClick={() => seekBy(-10)} type="button">
                        <Rewind size={16} />
                      </button>
                      <button aria-label={t.forward10} onClick={() => seekBy(10)} type="button">
                        <FastForward size={16} />
                      </button>
                      <span>
                        {formatTime(currentTime)} / {formatTime(duration)}
                        {processingHls && bufferedUntil > currentTime
                          ? ` · ${t.seekableReady} ${formatTime(bufferedUntil)}`
                          : ""}
                      </span>
                    </div>
                    <div className="watch-control-cluster">
                      <button aria-label={t.mute} onClick={toggleMute} type="button">
                        {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                      </button>
                      <input
                        aria-label={t.volume}
                        max={1}
                        min={0}
                        onChange={(event) => setVolume(Number(event.target.value))}
                        step={0.05}
                        type="range"
                        value={muted ? 0 : volume}
                      />
                      <select
                        aria-label={t.playbackRate}
                        onChange={(event) => changePlaybackRate(Number(event.target.value))}
                        value={playbackRate}
                      >
                        {playbackRateOptions.map((rate) => (
                          <option key={rate} value={rate}>
                            {rate}x
                          </option>
                        ))}
                      </select>
                      <button aria-label={t.episodePanel} onClick={() => setPanelOpen((value) => !value)} type="button">
                        <ListVideo size={16} />
                      </button>
                      <button aria-label={t.fullscreen} onClick={toggleFullscreen} type="button">
                        <Maximize size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="watch-state">
              <Loader2 size={18} />
              {descriptor?.transcodeStatus === "PROCESSING"
                ? t.transcodeProcessing
                : t.transcodePreparing}
            </div>
          )}
        </div>
        <div className="watch-underbar">
          {previousEpisode ? (
            <a href={`/${locale}/watch/${previousEpisode.id}`}>
              <SkipBack size={14} />
              {t.previousEpisode}
            </a>
          ) : <span />}
          <button onClick={() => setNativeControls((value) => !value)} type="button">
            {nativeControls ? t.customControls : t.nativeControls}
          </button>
          {nextEpisode ? (
            <a href={`/${locale}/watch/${nextEpisode.id}`}>
              {t.nextEpisode}
              <SkipForward size={14} />
            </a>
          ) : <span />}
        </div>
      </div>
      <aside className="watch-inspector">
        <section>
          <div className="watch-panel-heading">
            <h2>{t.episodePanel}</h2>
            <span>{episodes.length} {t.episodes}</span>
          </div>
          <div className="watch-episode-list">
            {episodes.map((item) => (
              <a
                className={item.id === episodeId ? "active" : ""}
                href={`/${locale}/watch/${item.id}`}
                key={item.id}
              >
                <strong>
                  S{String(item.seasonNumber).padStart(2, "0")}E{String(item.number).padStart(2, "0")}
                </strong>
                <span>{item.title || t.unknownTitle}</span>
                {item.progress?.durationSec ? (
                  <small>{Math.round((item.progress.positionSec / item.progress.durationSec) * 100)}%</small>
                ) : null}
              </a>
            ))}
          </div>
        </section>

        <section>
          <div className="watch-panel-heading">
            <h2>{t.fileVersion}</h2>
            <span>{currentEpisodeLabel(currentEpisode)}</span>
          </div>
          <div className="watch-version-list">
            {episodes.find((item) => item.id === episodeId)?.files.map((file) => (
              <a
                className={file.id === mediaFileId ? "active" : ""}
                href={`/${locale}/watch/${episodeId}?file=${file.id}`}
                key={file.id}
              >
                <strong>{formatMediaFileLabel(file)}</strong>
                <small>{file.originalName}</small>
              </a>
            ))}
          </div>
        </section>

        <section>
          <div className="watch-panel-heading">
            <h2>{t.playbackStatus}</h2>
          </div>
          {error ? <div className="settings-alert">{error}</div> : null}
          <dl>
            <div>
              <dt>{t.playbackMode}</dt>
              <dd>{descriptor?.playbackMode ?? "-"}</dd>
            </div>
            <div>
              <dt>{t.transcodeStatus}</dt>
              <dd>{descriptor?.transcodeStatus ?? "-"}</dd>
            </div>
            <div>
              <dt>{t.resolution}</dt>
              <dd>{descriptor?.mediaFile.sourceResolution ?? descriptor?.mediaFile.resolution ?? "-"}</dd>
            </div>
            <div>
              <dt>{t.codec}</dt>
              <dd>
                {descriptor?.mediaFile.videoCodec ?? "-"} /{" "}
                {descriptor?.mediaFile.audioCodec ?? "-"}
              </dd>
            </div>
          </dl>
          {descriptor?.mediaFile.transcodeError ? (
            <p className="watch-error">{descriptor.mediaFile.transcodeError}</p>
          ) : null}
          {!descriptor?.direct && descriptor?.transcodeStatus !== "READY" ? (
            <button onClick={() => void prepareHls()} type="button">
              <RefreshCw size={14} />
              {t.preparePlayback}
            </button>
          ) : null}
        </section>
      </aside>
    </div>
  );
}

const playbackRateOptions = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function formatTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "00:00";
  }
  const total = Math.floor(value);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function seekableLimit(video: HTMLVideoElement, fallbackDuration: number) {
  const buffered = bufferedEnd(video);
  if (buffered > 0) {
    return buffered;
  }
  return Number.isFinite(video.duration) && video.duration > 0
    ? video.duration
    : fallbackDuration;
}

function bufferedEnd(video: HTMLVideoElement) {
  if (video.buffered.length === 0) {
    return 0;
  }
  return video.buffered.end(video.buffered.length - 1);
}

function formatMediaFileLabel(file: WatchMediaFile) {
  return [
    file.sourceResolution ?? file.resolution,
    file.videoCodec,
    file.audioCodec,
    file.subtitleGroup,
  ].filter(Boolean).join(" / ") || file.originalName;
}

function currentEpisodeLabel(episode: EpisodeLink) {
  return `S${String(episode.seasonNumber).padStart(2, "0")}E${String(episode.number).padStart(2, "0")}`;
}
