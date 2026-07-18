import { load } from "cheerio";
import type {
  VideoEpisodeSource,
  VideoSourceEpisode,
  VideoSourceInspectionDraft,
  VideoSourcePlugin,
} from "../types";

const allowedHosts = new Set(["agedm.io", "www.agedm.io", "m.agedm.io"]);
const detailPattern = /^\/detail\/(\d+)\/?$/;
const playPattern = /^\/play\/(\d+)\/(\d+)\/(\d+)\/?$/;

export class AgedmInspectionError extends Error {}

export const agedmPlugin: VideoSourcePlugin = {
  id: "agedm",
  displayName: "AGE动漫",

  canHandle(url) {
    return (
      url.protocol === "https:" &&
      allowedHosts.has(url.hostname.toLowerCase()) &&
      (detailPattern.test(url.pathname) || playPattern.test(url.pathname))
    );
  },

  async inspect(url, context) {
    const match = url.pathname.match(detailPattern) ?? url.pathname.match(playPattern);
    const sourceItemId = match?.[1];
    if (!sourceItemId) {
      throw new AgedmInspectionError("AGE URL does not contain a supported item identifier.");
    }
    const playMatch = url.pathname.match(playPattern);
    const requestedSourceIndex = playMatch ? Number(playMatch[2]) : null;
    const requestedEpisodeIndex = playMatch ? Number(playMatch[3]) : null;
    const detailUrl = new URL(`/detail/${sourceItemId}`, "https://www.agedm.io");
    const html = await context.fetchHtml(detailUrl);
    const $ = load(html);
    const title = cleanTitle(
      $('meta[property="og:title"]').attr("content") || $("title").first().text(),
    );
    if (!title) {
      throw new AgedmInspectionError("AGE detail page did not expose a title.");
    }

    const grouped = new Map<number, Map<string, VideoEpisodeSource>>();
    $('a[href*="/play/"]').each((_index, element) => {
      const href = $(element).attr("href");
      if (!href) {
        return;
      }
      let playUrl: URL;
      try {
        playUrl = new URL(href, detailUrl);
      } catch {
        return;
      }
      const episodeMatch = playUrl.pathname.match(playPattern);
      if (!episodeMatch || episodeMatch[1] !== sourceItemId) {
        return;
      }
      const sourceIndex = Number(episodeMatch[2]);
      const episodeIndex = Number(episodeMatch[3]);
      if (!Number.isInteger(sourceIndex) || !Number.isInteger(episodeIndex)) {
        return;
      }
      const sources = grouped.get(episodeIndex) ?? new Map<string, VideoEpisodeSource>();
      const normalizedPlayUrl = new URL(
        `/play/${sourceItemId}/${sourceIndex}/${episodeIndex}`,
        "https://www.agedm.io",
      ).toString();
      sources.set(normalizedPlayUrl, {
        id: `line:${sourceIndex}`,
        label: `线路 ${sourceIndex}`,
        playUrl: normalizedPlayUrl,
        sourceIndex,
      });
      grouped.set(episodeIndex, sources);
    });

    const episodes = [...grouped.entries()]
      .filter(([episodeIndex]) =>
        requestedEpisodeIndex === null ? true : episodeIndex === requestedEpisodeIndex,
      )
      .sort(([left], [right]) => left - right)
      .map(([episodeIndex, sources]): VideoSourceEpisode => ({
        key: `episode:${episodeIndex}`,
        number: episodeIndex,
        label: episodeLabel($, sourceItemId, episodeIndex),
        sources: [...sources.values()].sort((left, right) => {
          if (requestedSourceIndex !== null) {
            if (left.sourceIndex === requestedSourceIndex) return -1;
            if (right.sourceIndex === requestedSourceIndex) return 1;
          }
          return left.sourceIndex - right.sourceIndex;
        }),
      }));

    if (episodes.length === 0) {
      throw new AgedmInspectionError("AGE detail page did not expose any matching episodes.");
    }

    return {
      provider: "agedm",
      providerName: "AGE动漫",
      sourceItemId,
      sourceUrl: url.toString(),
      canonicalUrl: detailUrl.toString(),
      kind: playMatch ? "play" : "detail",
      title,
      description: $('meta[name="description"]').attr("content")?.trim() || null,
      posterUrl: $('meta[property="og:image"]').attr("content")?.trim() || null,
      seasonNumber: 1,
      episodes,
    } satisfies VideoSourceInspectionDraft;
  },
};

function cleanTitle(value: string) {
  return value
    .replace(/\s*[-–—]\s*AGE动漫\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function episodeLabel(
  $: ReturnType<typeof load>,
  sourceItemId: string,
  episodeIndex: number,
) {
  const element = $(`a[href$="/play/${sourceItemId}/1/${episodeIndex}"]`).first();
  const text = element.text().replace(/\s+/g, " ").trim();
  return /^第.+集/.test(text) ? text : `第${String(episodeIndex).padStart(2, "0")}集`;
}
