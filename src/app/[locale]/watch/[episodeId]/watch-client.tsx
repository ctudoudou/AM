"use client";

import {
  MediaPlayer,
  MediaProvider,
  Track,
  type MediaPlayerInstance,
  type PlayerSrc,
} from "@vidstack/react";
import {
  DefaultVideoLayout,
  defaultLayoutIcons,
} from "@vidstack/react/player/layouts/default";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Captions,
  Languages,
  ListVideo,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { getMessages } from "@/messages";
import type { Locale } from "@/lib/i18n";
import { resolvePlaybackDuration } from "@/lib/transcode-profile";

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
  transcodeProgress?: {
    positionSec: number;
    percent: number | null;
    speed: string | null;
    backend: string | null;
    engine: string | null;
    hardwareAccelerated: boolean;
    fallbackFrom: string[];
  } | null;
};

type SubtitleTrackDescriptor = {
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

type WatchProgressPayload = {
  episodeId: string;
  positionSec: number;
  durationSec?: number;
};

const AUTO_NEXT_STORAGE_KEY = "kura.watch.autoNext";
const WATCH_PROGRESS_FLUSH_INTERVAL_MS = 10_000;

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
  const lastProgressKeyRef = useRef("");
  const autoNextRef = useRef(false);
  const nextEpisodeRef = useRef(nextEpisode);
  const preparationStartedAtRef = useRef<number | null>(null);
  const [descriptor, setDescriptor] = useState<PlaybackDescriptor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [panelOpen, setPanelOpen] = useState(true);
  const [ended, setEnded] = useState(false);
  const [autoNext, setAutoNext] = useState(false);
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrackDescriptor[]>([]);
  const [subtitleLoading, setSubtitleLoading] = useState(false);
  const [translatingSubtitleId, setTranslatingSubtitleId] = useState<string | null>(null);
  const [subtitleMessage, setSubtitleMessage] = useState("");
  const [preparationElapsed, setPreparationElapsed] = useState(0);

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
      if (body.transcodeStatus === "PROCESSING" && descriptorRef.current?.transcodeStatus !== "PROCESSING") {
        preparationStartedAtRef.current = Date.now();
        setPreparationElapsed(0);
      } else if (body.transcodeStatus !== "PROCESSING") {
        preparationStartedAtRef.current = null;
        setPreparationElapsed(0);
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

  const loadSubtitles = useCallback(async () => {
    const response = await fetch(`/api/media-files/${mediaFileId}/subtitles`);
    if (!response.ok) {
      return;
    }
    const body = (await response.json()) as { tracks: SubtitleTrackDescriptor[] };
    setSubtitleTracks(body.tracks);
  }, [mediaFileId]);

  const scanSubtitles = useCallback(async () => {
    setSubtitleLoading(true);
    setSubtitleMessage("");
    try {
      const response = await fetch(`/api/media-files/${mediaFileId}/subtitles/scan`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(t.subtitleScanError);
      }
      const body = (await response.json()) as {
        discovered: number;
        tracks: SubtitleTrackDescriptor[];
      };
      setSubtitleTracks(body.tracks);
      setSubtitleMessage(`${t.subtitleScanDone} ${body.discovered}`);
    } catch (scanError) {
      setSubtitleMessage(scanError instanceof Error ? scanError.message : t.subtitleScanError);
    } finally {
      setSubtitleLoading(false);
    }
  }, [mediaFileId, t.subtitleScanDone, t.subtitleScanError]);

  const translateSubtitle = useCallback(
    async (track: SubtitleTrackDescriptor, targetLanguage: "zh-Hans" | "zh-Hant") => {
      setTranslatingSubtitleId(`${track.id}:${targetLanguage}`);
      setSubtitleMessage("");
      try {
        const response = await fetch(`/api/subtitles/${track.id}/translate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetLanguage }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(body?.message || t.subtitleTranslateError);
        }
        const body = (await response.json()) as { tracks: SubtitleTrackDescriptor[] };
        setSubtitleTracks(body.tracks);
        setSubtitleMessage(t.subtitleTranslateDone);
      } catch (translateError) {
        setSubtitleMessage(
          translateError instanceof Error ? translateError.message : t.subtitleTranslateError,
        );
      } finally {
        setTranslatingSubtitleId(null);
      }
    },
    [t.subtitleTranslateDone, t.subtitleTranslateError],
  );

  const flushProgress = useCallback((options?: {
    beacon?: boolean;
    force?: boolean;
    keepalive?: boolean;
  }) => {
    if (Number.isNaN(currentTimeRef.current)) {
      return undefined;
    }

    const durationSec =
      Number.isFinite(durationRef.current) && durationRef.current > 0
        ? Math.floor(durationRef.current)
        : undefined;
    const payload: WatchProgressPayload = {
      episodeId,
      positionSec: Math.max(
        0,
        Math.min(Math.floor(currentTimeRef.current), durationSec ?? Number.MAX_SAFE_INTEGER),
      ),
      durationSec,
    };
    const progressKey = JSON.stringify(payload);
    if (!options?.force && progressKey === lastProgressKeyRef.current) {
      return undefined;
    }

    if (options?.beacon && typeof navigator !== "undefined" && "sendBeacon" in navigator) {
      const queued = navigator.sendBeacon(
        "/api/watch-progress",
        new Blob([progressKey], { type: "application/json" }),
      );
      if (queued) {
        lastProgressKeyRef.current = progressKey;
        return undefined;
      }
    }

    return fetch("/api/watch-progress", {
      method: options?.beacon || options?.keepalive ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: progressKey,
      keepalive: Boolean(options?.keepalive),
    })
      .then(() => {
        lastProgressKeyRef.current = progressKey;
      })
      .catch(() => undefined);
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
      void loadSubtitles();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [load, loadSubtitles]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 900px)");
    const syncPanelState = () => setPanelOpen(!mediaQuery.matches);
    syncPanelState();
    mediaQuery.addEventListener("change", syncPanelState);
    return () => mediaQuery.removeEventListener("change", syncPanelState);
  }, []);

  useEffect(() => {
    descriptorRef.current = descriptor;
  }, [descriptor]);

  useEffect(() => {
    nextEpisodeRef.current = nextEpisode;
  }, [nextEpisode]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const storedPreference = window.localStorage.getItem(AUTO_NEXT_STORAGE_KEY);
      if (storedPreference === "1") {
        autoNextRef.current = true;
        setAutoNext(true);
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

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
    }, 2000);
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
    if (descriptor?.transcodeStatus !== "PROCESSING") {
      preparationStartedAtRef.current = null;
      return;
    }
    preparationStartedAtRef.current ??= Date.now();
    const updateElapsed = () => {
      setPreparationElapsed(
        Math.max(0, Math.floor((Date.now() - (preparationStartedAtRef.current ?? Date.now())) / 1000)),
      );
    };
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [descriptor?.transcodeStatus, mediaFileId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void flushProgress();
    }, WATCH_PROGRESS_FLUSH_INTERVAL_MS);
    const flush = (beacon = false) => {
      void flushProgress({ beacon, force: true, keepalive: beacon });
    };
    const flushHidden = () => {
      if (document.visibilityState === "hidden") {
        flush(true);
      }
    };
    const flushOnPageHide = () => flush(true);
    const flushBeforeUnload = () => flush(true);
    document.addEventListener("visibilitychange", flushHidden);
    window.addEventListener("pagehide", flushOnPageHide);
    window.addEventListener("beforeunload", flushBeforeUnload);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", flushHidden);
      window.removeEventListener("pagehide", flushOnPageHide);
      window.removeEventListener("beforeunload", flushBeforeUnload);
      flush(true);
    };
  }, [flushProgress]);

  const toggleAutoNext = useCallback(() => {
    const nextValue = !autoNextRef.current;
    autoNextRef.current = nextValue;
    setAutoNext(nextValue);
    window.localStorage.setItem(AUTO_NEXT_STORAGE_KEY, nextValue ? "1" : "0");
  }, []);

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
                duration={sourceDurationSec ?? undefined}
                onDurationChange={(nextDuration) => {
                  durationRef.current = resolvePlaybackDuration(sourceDurationSec, nextDuration);
                }}
                onEnded={() => {
                  if (durationRef.current > 0) {
                    currentTimeRef.current = Math.max(currentTimeRef.current, durationRef.current);
                  }
                  const save = flushProgress({ force: true });
                  const next = nextEpisodeRef.current;
                  if (autoNextRef.current && next) {
                    const goToNext = () => {
                      window.location.href = `/${locale}/watch/${next.id}`;
                    };
                    if (save instanceof Promise) {
                      void save.finally(goToNext);
                    } else {
                      goToNext();
                    }
                    return;
                  }
                  setEnded(true);
                }}
                onError={() => setError(t.playbackLoadError)}
                onLoadedMetadata={() => {
                  if (!restoredRef.current && initialPositionSec > 0 && playerRef.current) {
                    playerRef.current.currentTime = initialPositionSec;
                  }
                  restoredRef.current = true;
                }}
                onPause={() => void flushProgress({ force: true })}
                onPlay={() => setEnded(false)}
                onSeeked={(nextTime) => {
                  currentTimeRef.current = nextTime;
                  void flushProgress({ force: true });
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
                {subtitleTracks.filter((track) => track.canPlay).map((track) => (
                  <Track
                    default={track.isDefault}
                    id={track.id}
                    key={track.id}
                    kind="subtitles"
                    label={track.label}
                    lang={track.language ?? undefined}
                    src={track.url}
                    type={subtitleTrackType(track.format)}
                  />
                ))}
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
            </>
          ) : (
            <div className="watch-state watch-preparing-state">
              <Loader2 size={18} />
              <span>
                <strong>
                  {descriptor?.transcodeStatus === "PROCESSING"
                    ? t.transcodeProcessing
                    : t.transcodePreparing}
                </strong>
                {descriptor?.transcodeStatus === "PROCESSING" ? (
                  <small>{t.playbackPreparingElapsed.replace("{seconds}", String(preparationElapsed))}</small>
                ) : null}
              </span>
            </div>
          )}
          <button
            aria-label={t.episodePanel}
            aria-controls="watch-inspector"
            aria-expanded={panelOpen}
            className="watch-panel-toggle"
            onClick={() => setPanelOpen((value) => !value)}
            type="button"
          >
            <ListVideo size={16} />
          </button>
        </div>
        {descriptor?.transcodeStatus === "PROCESSING" && descriptor.transcodeProgress ? (
          <div className="watch-transcode-progress">
            <div>
              <span>{t.transcodeProgress}</span>
              <strong>
                {descriptor.transcodeProgress.percent !== null
                  ? `${Math.floor(descriptor.transcodeProgress.percent)}%`
                  : formatPlaybackTime(descriptor.transcodeProgress.positionSec)}
              </strong>
            </div>
            <progress
              aria-label={t.transcodeProgress}
              max={100}
              value={descriptor.transcodeProgress.percent ?? undefined}
            />
            <small>
              {descriptor.transcodeProgress.engine ?? t.transcodeSoftware}
              {" · "}
              {descriptor.transcodeProgress.backend === "remux"
                ? t.transcodeStreamCopy
                : descriptor.transcodeProgress.hardwareAccelerated
                  ? t.transcodeHardware
                  : t.transcodeSoftware}
              {descriptor.transcodeProgress.speed
                ? ` · ${t.transcodeSpeed} ${descriptor.transcodeProgress.speed}`
                : ""}
              {descriptor.transcodeProgress.fallbackFrom.length > 0
                ? ` · ${t.transcodeFallback}`
                : ""}
            </small>
          </div>
        ) : null}
        <div className="watch-underbar">
          {previousEpisode ? (
            <a href={`/${locale}/watch/${previousEpisode.id}`}>
              <SkipBack size={14} />
              {t.previousEpisode}
            </a>
          ) : <span />}
          <span>{playbackModeLabel(descriptor?.playbackMode, t)}</span>
          {nextEpisode ? (
            <a href={`/${locale}/watch/${nextEpisode.id}`}>
              {t.nextEpisode}
              <SkipForward size={14} />
            </a>
          ) : <span />}
        </div>
      </div>
      <aside className="watch-inspector" id="watch-inspector">
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
            <h2>{t.subtitles}</h2>
            <span>{subtitleTracks.length} {t.subtitleTracks}</span>
          </div>
          <div className="watch-subtitle-actions">
            <button disabled={subtitleLoading} onClick={() => void scanSubtitles()} type="button">
              {subtitleLoading ? <Loader2 size={14} /> : <Search size={14} />}
              {t.scanSubtitles}
            </button>
          </div>
          {subtitleTracks.length === 0 ? (
            <p className="watch-muted">{t.noSubtitleTracks}</p>
          ) : (
            <div className="watch-subtitle-list">
              {subtitleTracks.map((track) => (
                <div className={track.canPlay || track.canTranslate ? "" : "muted"} key={track.id}>
                  <Captions size={14} />
                  <span>
                    <strong>{track.label}</strong>
                    <small>
                      {track.sourceName ?? track.kind}
                      {" · "}
                      {track.canPlay
                        ? t.subtitlePlayable
                        : track.canTranslate
                          ? t.subtitleTranslatable
                          : t.subtitleUnsupported}
                    </small>
                  </span>
                  {track.canTranslate && !isChineseSubtitleTrack(track) ? (
                    <div className="watch-subtitle-translate-actions">
                      <button
                        disabled={Boolean(translatingSubtitleId)}
                        onClick={() => void translateSubtitle(track, "zh-Hans")}
                        type="button"
                      >
                        {translatingSubtitleId === `${track.id}:zh-Hans` ? (
                          <Loader2 size={13} />
                        ) : (
                          <Languages size={13} />
                        )}
                        {t.translateSubtitleZhHans}
                      </button>
                      <button
                        disabled={Boolean(translatingSubtitleId)}
                        onClick={() => void translateSubtitle(track, "zh-Hant")}
                        type="button"
                      >
                        {translatingSubtitleId === `${track.id}:zh-Hant` ? (
                          <Loader2 size={13} />
                        ) : (
                          <Languages size={13} />
                        )}
                        {t.translateSubtitleZhHant}
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          {subtitleMessage ? <p className="watch-muted">{subtitleMessage}</p> : null}
        </section>

        <section>
          <div className="watch-panel-heading">
            <h2>{t.playbackStatus}</h2>
            <button
              aria-pressed={autoNext}
              className={autoNext ? "toggle active" : "toggle"}
              onClick={toggleAutoNext}
              type="button"
            >
              {t.autoNextEpisode}: {autoNext ? t.enabled : t.disabled}
            </button>
          </div>
          {error ? <div className="settings-alert">{error}</div> : null}
          <p className="watch-playback-explanation">
            {playbackModeDescription(descriptor?.playbackMode, t)}
          </p>
          <dl>
            <div>
              <dt>{t.playbackMode}</dt>
              <dd>{playbackModeLabel(descriptor?.playbackMode, t)}</dd>
            </div>
            <div>
              <dt>{t.transcodeStatus}</dt>
              <dd>{transcodeStatusLabel(descriptor?.transcodeStatus, t)}</dd>
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
            <details className="watch-error-details">
              <summary>{t.playbackErrorDetails}</summary>
              <p className="watch-error">{descriptor.mediaFile.transcodeError}</p>
            </details>
          ) : null}
          {!descriptor?.direct && ["PENDING", "FAILED"].includes(descriptor?.transcodeStatus ?? "") ? (
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

function playbackModeLabel(mode: PlaybackDescriptor["playbackMode"] | undefined, t: ReturnType<typeof getMessages>) {
  if (mode === "DIRECT") return t.playbackModeDirect;
  if (mode === "HLS_REMUX") return t.playbackModeRemux;
  if (mode === "HLS_TRANSCODE") return t.playbackModeTranscode;
  return "-";
}

function playbackModeDescription(
  mode: PlaybackDescriptor["playbackMode"] | undefined,
  t: ReturnType<typeof getMessages>,
) {
  if (mode === "DIRECT") return t.playbackModeDirectDescription;
  if (mode === "HLS_REMUX") return t.playbackModeRemuxDescription;
  if (mode === "HLS_TRANSCODE") return t.playbackModeTranscodeDescription;
  return t.transcodePreparing;
}

function transcodeStatusLabel(
  status: PlaybackDescriptor["transcodeStatus"] | undefined,
  t: ReturnType<typeof getMessages>,
) {
  if (status === "NOT_REQUIRED") return t.transcodeStatusNotRequired;
  if (status === "PENDING") return t.transcodeStatusPending;
  if (status === "PROCESSING") return t.transcodeStatusProcessing;
  if (status === "READY") return t.transcodeStatusReady;
  if (status === "FAILED") return t.transcodeStatusFailed;
  return "-";
}

function formatMediaFileLabel(file: WatchMediaFile) {
  return [
    file.sourceResolution ?? file.resolution,
    file.videoCodec,
    file.audioCodec,
    file.subtitleGroup,
  ].filter(Boolean).join(" / ") || file.originalName;
}

function isChineseSubtitleTrack(track: SubtitleTrackDescriptor) {
  return track.language === "zh" || track.language === "zh-Hans" || track.language === "zh-Hant";
}

function currentEpisodeLabel(episode: EpisodeLink) {
  return `S${String(episode.seasonNumber).padStart(2, "0")}E${String(episode.number).padStart(2, "0")}`;
}

function formatPlaybackTime(seconds: number) {
  const rounded = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
    : `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function mimeTypeForFile(fileName?: string | null) {
  const lower = fileName?.toLowerCase() ?? "";
  if (lower.endsWith(".webm")) {
    return "video/webm";
  }
  return "video/mp4";
}

function subtitleTrackType(format: string) {
  const lower = format.toLowerCase();
  if (lower === "srt" || lower === "ass" || lower === "ssa" || lower === "vtt") {
    return lower;
  }
  return "vtt";
}
