export type ReleaseResourceKind = "VIDEO" | "NON_VIDEO" | "UNKNOWN";

export type ReleaseResourceClassification = {
  kind: ReleaseResourceKind;
  reason?: string;
};

const videoContainerPattern = /(?:^|[\s._\-[({])(?:mkv|mp4|m2ts|ts|webm|avi|mov)(?:$|[\s._\-\])}])/i;
const videoExtensionPattern = /\.(?:mkv|mp4|m2ts|ts|webm|avi|mov)$/i;
const videoCodecPattern = /\b(?:x265|x264|h\.?265|h\.?264|hevc|avc|av1)\b/i;
const videoResolutionPattern = /\b(?:2160p|4k|1080p|720p|480p|3840x2160|1920x1080|1280x720)\b/i;
const videoSourcePattern = /\b(?:web\s?-?dl|webrip|hdtv|bdrip|bdremux|blu\s?-?ray|bluray|baha|b-global|crunchyroll|abema)\b/i;
const episodePattern =
  /(?:\bS\d{1,2}E\d{1,4}\b|\bEP?\s?\d{1,4}\b|第\s?\d{1,4}\s?[话話集]|(?:^|[\s_\-[({])\d{1,3}(?:v\d)?(?:$|[\s_\-\])}]))/i;

const sampleRatePattern = /\b(?:44\.1|48|88\.2|96|176\.4|192)\s?kHz\b/i;
const bitDepthPattern = /\b(?:16|24|32)\s?bit\b/i;
const audioFormatPattern = /\b(?:flac|mp3|alac|wav|ape|m4a|cue|log)\b/i;
const archiveExtensionPattern = /\.(?:zip|rar|7z)$/i;
const musicReleasePattern =
  /(?:hi[\s-]?res|lossless|original soundtrack|soundtrack|ost|character song|album|single|ドラマcd|特典cd|オリジナルサウンドトラック|サウンドトラック|キャラクターソング|主題歌|挿入歌|opテーマ|edテーマ|專輯|专辑|單曲|单曲|广播剧|廣播劇)/i;
const discPattern = /(?:^|[\s._\-[({])(?:cd|disc)\s?\d?(?:$|[\s._\-\])}])/i;
const datedMusicReleasePattern = /\[(?:19|20)\d{2}[.-]\d{2}[.-]\d{2}\]/;

export function classifyReleaseResource(rawTitle: string): ReleaseResourceClassification {
  const title = rawTitle.trim();
  if (!title) {
    return { kind: "UNKNOWN" };
  }

  const hasVideoSignal =
    videoExtensionPattern.test(title) ||
    videoCodecPattern.test(title) ||
    videoResolutionPattern.test(title) ||
    videoContainerPattern.test(title) ||
    videoSourcePattern.test(title);

  if (hasVideoSignal) {
    return { kind: "VIDEO" };
  }

  const musicSignals = [
    sampleRatePattern.test(title),
    bitDepthPattern.test(title),
    audioFormatPattern.test(title),
    archiveExtensionPattern.test(title),
    musicReleasePattern.test(title),
    discPattern.test(title),
    datedMusicReleasePattern.test(title) && (audioFormatPattern.test(title) || musicReleasePattern.test(title)),
  ].filter(Boolean).length;

  if (musicSignals >= 2) {
    return {
      kind: "NON_VIDEO",
      reason: "audio or music release without video signals",
    };
  }

  if (
    musicReleasePattern.test(title) &&
    audioFormatPattern.test(title) &&
    !episodePattern.test(title)
  ) {
    return {
      kind: "NON_VIDEO",
      reason: "music release without episode or video signals",
    };
  }

  return { kind: "UNKNOWN" };
}

export function nonVideoReleaseParseError(classification: ReleaseResourceClassification) {
  return `Skipped non-video RSS item: ${classification.reason ?? "not a playable video release"}`;
}
