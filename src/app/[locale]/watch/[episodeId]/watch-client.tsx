"use client";

import {
  MediaPlayer,
  MediaProvider,
  type MediaPlayerInstance,
  type PlayerSrc,
} from "@vidstack/react";
import {
  DefaultVideoLayout,
  defaultLayoutIcons,
} from "@vidstack/react/player/layouts/default";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ListVideo,
  Loader2,
  RefreshCw,
  RotateCcw,
  SkipBack,
  SkipForward,
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
  const playerRef = useRef<MediaPlayerInstance | null>(null);
  const descriptorRef = useRef<PlaybackDescriptor | null>(null);
  const currentTimeRef = useRef(initialPositionSec);
  const durationRef = useRef(0);
  const restoredRef = useRef(false);
  const [descriptor, setDescriptor] = useState<PlaybackDescriptor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
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
        durationRef.current = body.sourceDurationSec;
      }
      setDescriptor(body);
      descriptorRef.current = body;
      setEnded(false);
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
    if (Number.isNaN(currentTimeRef.current)) {
      return;
    }
    await fetch("/api/watch-progress", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        episodeId,
        positionSec: Math.floor(currentTimeRef.current),
        durationSec:
          Number.isFinite(durationRef.current) && durationRef.current > 0
            ? Math.floor(durationRef.current)
            : undefined,
      }),
    }).catch(() => undefined);
  }, [episodeId]);

  const seekTo = useCallback((seconds: number) => {
    const player = playerRef.current;
    if (!player) {
      return;
    }
    const nextTime = Math.max(seconds, 0);
    player.currentTime = nextTime;
    currentTimeRef.current = nextTime;
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
  const playerSource = useMemo<PlayerSrc | undefined>(() => {
    if (hlsUrl) {
      return { src: hlsUrl, type: "application/vnd.apple.mpegurl" };
    }
    if (streamUrl) {
      return {
        src: streamUrl,
        type: mimeTypeForFile(descriptor?.mediaFile.originalName),
      };
    }
    return undefined;
  }, [descriptor?.mediaFile.originalName, hlsUrl, streamUrl]);

  useEffect(() => {
    currentTimeRef.current = initialPositionSec;
    durationRef.current = sourceDurationSec ?? 0;
    restoredRef.current = false;
  }, [initialPositionSec, mediaFileId, sourceDurationSec]);

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

  return (
    <div className={`watch-stage ${panelOpen ? "panel-open" : ""}`}>
      <div className="watch-player-shell">
        <div className="watch-player">
          {sourceReady && playerSource ? (
            <>
              <MediaPlayer
                aspectRatio="16/9"
                className="kura-media-player"
                onDurationChange={(nextDuration) => {
                  durationRef.current = Number.isFinite(nextDuration)
                    ? nextDuration
                    : durationRef.current;
                }}
                onEnded={() => {
                  setEnded(true);
                  void saveProgress();
                }}
                onError={() => setError(t.playbackLoadError)}
                onLoadedMetadata={() => {
                  if (!restoredRef.current && initialPositionSec > 0 && playerRef.current) {
                    playerRef.current.currentTime = initialPositionSec;
                  }
                  restoredRef.current = true;
                }}
                onPause={() => void saveProgress()}
                onPlay={() => setEnded(false)}
                onSeeked={(nextTime) => {
                  currentTimeRef.current = nextTime;
                  void saveProgress();
                }}
                onSeeking={(nextTime) => {
                  currentTimeRef.current = nextTime;
                }}
                onTimeUpdate={(detail) => {
                  currentTimeRef.current = detail.currentTime;
                }}
                playsInline
                preload="metadata"
                ref={playerRef}
                src={playerSource}
                streamType="on-demand"
                title={currentEpisodeLabel(currentEpisode)}
                viewType="video"
              >
                <MediaProvider />
                <DefaultVideoLayout
                  colorScheme="dark"
                  icons={defaultLayoutIcons}
                  playbackRates={[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]}
                  seekStep={10}
                  smallLayoutWhen={({ width, height }) => width < 620 || height < 420}
                />
              </MediaPlayer>
              {ended ? (
                <div className="watch-ended">
                  <strong>{t.playbackEnded}</strong>
                  <div>
                    <button onClick={() => {
                      seekTo(0);
                      void playerRef.current?.play();
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
              <button
                aria-label={t.episodePanel}
                className="watch-panel-toggle"
                onClick={() => setPanelOpen((value) => !value)}
                type="button"
              >
                <ListVideo size={16} />
              </button>
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
          <span>{descriptor?.playbackMode ?? "-"}</span>
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

function mimeTypeForFile(fileName?: string | null) {
  const lower = fileName?.toLowerCase() ?? "";
  if (lower.endsWith(".webm")) {
    return "video/webm";
  }
  return "video/mp4";
}
