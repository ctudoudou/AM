import { createHash } from "node:crypto";
import { fetchPublicHtml } from "./network-safety";
import { agedmPlugin } from "./providers/agedm";
import type { VideoSourceInspection, VideoSourceInspectionDraft, VideoSourcePlugin } from "./types";

const plugins: VideoSourcePlugin[] = [agedmPlugin];

export class UnsupportedVideoSourceError extends Error {}
export class VideoSourcePlanStaleError extends Error {}

export async function inspectVideoSource(input: string): Promise<VideoSourceInspection> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UnsupportedVideoSourceError("Enter a valid video detail or play URL.");
  }
  const plugin = plugins.find((candidate) => candidate.canHandle(url));
  if (!plugin) {
    throw new UnsupportedVideoSourceError(
      `No installed video source plugin supports ${url.hostname || "this URL"}.`,
    );
  }
  const inspection = await plugin.inspect(url, { fetchHtml: fetchPublicHtml });
  return { ...inspection, planId: buildVideoSourcePlanId(inspection) };
}

export function assertVideoSourcePlanCurrent(
  inspection: VideoSourceInspection,
  expectedPlanId: string,
) {
  if (inspection.planId !== expectedPlanId) {
    throw new VideoSourcePlanStaleError(
      "The source page changed after inspection. Inspect it again before downloading.",
    );
  }
}

export function listVideoSourcePlugins() {
  return plugins.map(({ id, displayName }) => ({ id, displayName }));
}

export function buildVideoSourcePlanId(inspection: VideoSourceInspectionDraft) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        provider: inspection.provider,
        sourceItemId: inspection.sourceItemId,
        canonicalUrl: inspection.canonicalUrl,
        title: inspection.title,
        seasonNumber: inspection.seasonNumber,
        episodes: inspection.episodes.map((episode) => ({
          key: episode.key,
          number: episode.number,
          sources: episode.sources.map((source) => ({ id: source.id, playUrl: source.playUrl })),
        })),
      }),
    )
    .digest("hex");
}
