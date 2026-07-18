export type VideoSourceFormat = "mp4" | "hls" | "dash";

export type VideoEpisodeSource = {
  id: string;
  label: string;
  playUrl: string;
  sourceIndex: number;
};

export type VideoSourceEpisode = {
  key: string;
  number: number;
  label: string;
  sources: VideoEpisodeSource[];
};

export type VideoSourceInspectionDraft = {
  provider: string;
  providerName: string;
  sourceItemId: string;
  sourceUrl: string;
  canonicalUrl: string;
  kind: "detail" | "play";
  title: string;
  description: string | null;
  posterUrl: string | null;
  seasonNumber: number;
  episodes: VideoSourceEpisode[];
};

export type VideoSourceInspection = VideoSourceInspectionDraft & {
  planId: string;
};

export type ResolvedVideoSource = {
  provider: string;
  sourceId: string;
  sourcePageUrl: string;
  mediaUrl: string;
  mediaHost: string;
  format: VideoSourceFormat;
  contentType: string | null;
  sizeBytes: bigint | null;
  requestHeaders: {
    referer?: string;
    origin?: string;
    userAgent?: string;
  };
};

export type VideoSourcePluginContext = {
  fetchHtml: (url: URL) => Promise<string>;
};

export interface VideoSourcePlugin {
  id: string;
  displayName: string;
  canHandle(url: URL): boolean;
  inspect(url: URL, context: VideoSourcePluginContext): Promise<VideoSourceInspectionDraft>;
}
