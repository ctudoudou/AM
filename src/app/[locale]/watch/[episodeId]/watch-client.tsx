"use client";

import Hls from "hls.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { getMessages } from "@/messages";
import type { Locale } from "@/lib/i18n";

type PlaybackDescriptor = {
  direct: boolean;
  playbackMode: "DIRECT" | "HLS_REMUX" | "HLS_TRANSCODE" | null;
  transcodeStatus: "NOT_REQUIRED" | "PENDING" | "PROCESSING" | "READY" | "FAILED";
  streamUrl?: string | null;
  hlsUrl?: string | null;
  mediaFile: {
    id: string;
    originalName: string;
    sourceResolution?: string | null;
    resolution?: string | null;
    videoCodec?: string | null;
    audioCodec?: string | null;
    transcodeError?: string | null;
  };
};

export function WatchClient({
  episodeId,
  initialPositionSec,
  locale,
  mediaFileId,
}: {
  episodeId: string;
  initialPositionSec: number;
  locale: Locale;
  mediaFileId: string;
}) {
  const t = getMessages(locale);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [descriptor, setDescriptor] = useState<PlaybackDescriptor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/media-files/${mediaFileId}/playback`);
      if (!response.ok) {
        throw new Error(t.playbackLoadError);
      }
      const body = (await response.json()) as PlaybackDescriptor;
      setDescriptor(body);
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

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

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

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !descriptor) {
      return;
    }
    const sourceUrl = descriptor.streamUrl ?? descriptor.hlsUrl;
    if (!sourceUrl) {
      return;
    }

    let hls: Hls | null = null;
    if (descriptor.hlsUrl && Hls.isSupported()) {
      hls = new Hls({ enableWorker: true });
      hls.loadSource(descriptor.hlsUrl);
      hls.attachMedia(video);
    } else {
      video.src = sourceUrl;
    }

    const restore = () => {
      if (initialPositionSec > 0 && video.duration > initialPositionSec) {
        video.currentTime = initialPositionSec;
      }
    };
    video.addEventListener("loadedmetadata", restore, { once: true });

    return () => {
      hls?.destroy();
      video.removeEventListener("loadedmetadata", restore);
    };
  }, [descriptor, initialPositionSec]);

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

  return (
    <div className="watch-stage">
      <div className="watch-player">
        {descriptor?.streamUrl || descriptor?.hlsUrl ? (
          <video
            controls
            onEnded={() => void saveProgress()}
            onPause={() => void saveProgress()}
            playsInline
            ref={videoRef}
          />
        ) : (
          <div className="watch-state">
            <Loader2 size={18} />
            {descriptor?.transcodeStatus === "PROCESSING"
              ? t.transcodeProcessing
              : t.transcodePreparing}
          </div>
        )}
      </div>
      <aside className="watch-inspector">
        <h2>{t.playbackStatus}</h2>
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
      </aside>
    </div>
  );
}
