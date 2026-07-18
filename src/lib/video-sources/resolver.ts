import fs from "node:fs/promises";
import { chromium, type BrowserContext, type Response as PlaywrightResponse } from "playwright-core";
import { serverEnv } from "@/lib/env";
import { assertPublicHttpUrl, VideoSourceNetworkError } from "./network-safety";
import type {
  ResolvedVideoSource,
  VideoEpisodeSource,
  VideoSourceEpisode,
  VideoSourceFormat,
} from "./types";

const chromiumCandidates = [
  serverEnv.VIDEO_RESOLVER_CHROMIUM_PATH,
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].filter((candidate): candidate is string => Boolean(candidate));

type MediaCandidate = {
  url: string;
  format: VideoSourceFormat;
  contentType: string | null;
  sizeBytes: bigint | null;
  requestHeaders: ResolvedVideoSource["requestHeaders"];
};

export class VideoSourceResolutionError extends Error {
  constructor(
    message: string,
    readonly attempts: Array<{ sourceId: string; message: string }> = [],
  ) {
    super(message);
  }
}

export async function resolveVideoEpisode(
  provider: string,
  episode: VideoSourceEpisode,
  options: { timeoutMs?: number; settleMs?: number } = {},
): Promise<ResolvedVideoSource> {
  const executablePath = await findChromiumExecutable();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--disable-dev-shm-usage", "--no-sandbox", "--disable-setuid-sandbox"],
  });
  const attempts: Array<{ sourceId: string; message: string }> = [];
  try {
    for (const source of episode.sources) {
      try {
        const candidate = await resolveSourceInBrowser(source, options);
        const probed = await probeMediaCandidate(candidate);
        if (probed.format !== "mp4") {
          throw new VideoSourceResolutionError(
            `Resolved ${probed.format.toUpperCase()} media; P0 currently accepts direct MP4 only.`,
          );
        }
        return {
          provider,
          sourceId: source.id,
          sourcePageUrl: source.playUrl,
          mediaUrl: probed.url,
          mediaHost: new URL(probed.url).hostname,
          format: probed.format,
          contentType: probed.contentType,
          sizeBytes: probed.sizeBytes,
          requestHeaders: probed.requestHeaders,
        };
      } catch (error) {
        attempts.push({
          sourceId: source.id,
          message: error instanceof Error ? error.message : "Unknown resolver error",
        });
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  throw new VideoSourceResolutionError(
    `No playable direct MP4 source was resolved for ${episode.label}.`,
    attempts,
  );

  async function resolveSourceInBrowser(
    source: VideoEpisodeSource,
    resolverOptions: { timeoutMs?: number; settleMs?: number },
  ) {
    await assertPublicHttpUrl(source.playUrl);
    const context = await browser.newContext({
      acceptDownloads: false,
      ignoreHTTPSErrors: false,
      javaScriptEnabled: true,
      serviceWorkers: "block",
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/138.0 Safari/537.36 Kura/0.1",
    });
    let candidateTimeout: ReturnType<typeof setTimeout> | null = null;
    try {
      await installPublicNetworkGuard(context);
      const page = await context.newPage();
      const candidates: MediaCandidate[] = [];
      const pending = new Set<Promise<void>>();
      let notifyCandidate: (() => void) | null = null;
      let rejectCandidate: ((error: Error) => void) | null = null;
      const firstCandidate = new Promise<void>((resolve, reject) => {
        notifyCandidate = () => {
          if (candidateTimeout) clearTimeout(candidateTimeout);
          resolve();
        };
        rejectCandidate = reject;
      });
      page.on("response", (response) => {
        const task = captureCandidate(response)
          .then((candidate) => {
            if (candidate) {
              candidates.push(candidate);
              notifyCandidate?.();
            }
          })
          .finally(() => pending.delete(task));
        pending.add(task);
      });

      await page.goto(source.playUrl, {
        waitUntil: "domcontentloaded",
        timeout: resolverOptions.timeoutMs ?? 20_000,
      });
      if (candidates.length === 0) {
        candidateTimeout = setTimeout(() => {
          rejectCandidate?.(
            new VideoSourceResolutionError("Timed out waiting for a media response."),
          );
        }, resolverOptions.timeoutMs ?? 20_000);
      }
      await firstCandidate;
      await page.waitForTimeout(resolverOptions.settleMs ?? 1_500);
      await Promise.allSettled([...pending]);
      const selected = selectMediaCandidate(candidates);
      if (!selected) {
        throw new VideoSourceResolutionError("The player did not expose a usable media response.");
      }
      return selected;
    } finally {
      if (candidateTimeout) clearTimeout(candidateTimeout);
      await context.close().catch(() => undefined);
    }
  }
}

export function selectMediaCandidate(candidates: MediaCandidate[]) {
  return [...candidates]
    .filter((candidate) => !looksLikeAdvertisement(candidate.url))
    .sort((left, right) => mediaCandidateScore(right) - mediaCandidateScore(left))[0] ?? null;
}

async function captureCandidate(response: PlaywrightResponse): Promise<MediaCandidate | null> {
  const url = response.url();
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return null;
  }
  const headers = await response.allHeaders();
  const contentType = headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() ?? null;
  const format = detectMediaFormat(url, contentType, response.request().resourceType());
  if (!format || (response.status() !== 200 && response.status() !== 206)) {
    return null;
  }
  await assertPublicHttpUrl(url);
  const requestHeaders = response.request().headers();
  return {
    url,
    format,
    contentType,
    sizeBytes: responseSize(headers),
    requestHeaders: {
      referer: requestHeaders.referer,
      origin: requestHeaders.origin,
      userAgent: requestHeaders["user-agent"],
    },
  };
}

function detectMediaFormat(
  url: string,
  contentType: string | null,
  resourceType: string,
): VideoSourceFormat | null {
  const pathname = new URL(url).pathname.toLowerCase();
  if (contentType?.includes("mpegurl") || pathname.endsWith(".m3u8")) {
    return "hls";
  }
  if (contentType?.includes("dash+xml") || pathname.endsWith(".mpd")) {
    return "dash";
  }
  if (
    contentType === "video/mp4" ||
    pathname.endsWith(".mp4") ||
    (resourceType === "media" && contentType?.startsWith("video/"))
  ) {
    return "mp4";
  }
  return null;
}

async function probeMediaCandidate(candidate: MediaCandidate): Promise<MediaCandidate> {
  let current = await assertPublicHttpUrl(candidate.url);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(12_000),
      headers: {
        Range: "bytes=0-0",
        ...(candidate.requestHeaders.referer ? { Referer: candidate.requestHeaders.referer } : {}),
        ...(candidate.requestHeaders.origin ? { Origin: candidate.requestHeaders.origin } : {}),
        ...(candidate.requestHeaders.userAgent
          ? { "User-Agent": candidate.requestHeaders.userAgent }
          : {}),
      },
    });
    if (new Set([301, 302, 303, 307, 308]).has(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) {
        throw new VideoSourceNetworkError("Media probe redirected without a location.");
      }
      current = await assertPublicHttpUrl(new URL(location, current));
      continue;
    }
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase() ?? null;
    const format = detectMediaFormat(current.toString(), contentType, "media");
    const headers = Object.fromEntries(response.headers.entries());
    const sizeBytes = responseSize(headers) ?? candidate.sizeBytes;
    await response.body?.cancel();
    if ((response.status !== 200 && response.status !== 206) || !format) {
      throw new VideoSourceResolutionError(
        `Media probe failed: ${response.status} ${response.statusText}`,
      );
    }
    if (sizeBytes !== null && sizeBytes < BigInt(1024 * 1024)) {
      throw new VideoSourceResolutionError("Resolved media is too small to be a valid episode.");
    }
    return {
      ...candidate,
      url: current.toString(),
      format,
      contentType,
      sizeBytes,
    };
  }
  throw new VideoSourceResolutionError("Media probe exceeded the redirect limit.");
}

async function installPublicNetworkGuard(context: BrowserContext) {
  const allowedHosts = new Map<string, Promise<boolean>>();
  await context.route("**/*", async (route) => {
    const requestUrl = route.request().url();
    if (/^(?:data|blob|about):/i.test(requestUrl)) {
      await route.continue();
      return;
    }
    let url: URL;
    try {
      url = new URL(requestUrl);
    } catch {
      await route.abort("blockedbyclient");
      return;
    }
    const check = allowedHosts.get(url.hostname) ?? publicHostCheck(url);
    allowedHosts.set(url.hostname, check);
    if (await check) {
      await route.continue();
    } else {
      await route.abort("blockedbyclient");
    }
  });
}

async function publicHostCheck(url: URL) {
  try {
    await assertPublicHttpUrl(url);
    return true;
  } catch {
    return false;
  }
}

async function findChromiumExecutable() {
  for (const candidate of chromiumCandidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next configured executable.
    }
  }
  throw new VideoSourceResolutionError(
    "Chromium is unavailable. Install Chromium or set VIDEO_RESOLVER_CHROMIUM_PATH.",
  );
}

function responseSize(headers: Record<string, string>) {
  const range = headers["content-range"]?.match(/\/(\d+)$/);
  const value = range?.[1] ?? headers["content-length"];
  return value && /^\d+$/.test(value) ? BigInt(value) : null;
}

function mediaCandidateScore(candidate: MediaCandidate) {
  const formatScore = candidate.format === "mp4" ? 3_000 : candidate.format === "hls" ? 2_000 : 1_000;
  const sizeScore = candidate.sizeBytes
    ? Math.min(900, Math.log2(Number(candidate.sizeBytes > BigInt(Number.MAX_SAFE_INTEGER)
        ? BigInt(Number.MAX_SAFE_INTEGER)
        : candidate.sizeBytes)) * 30)
    : 0;
  return formatScore + sizeScore;
}

function looksLikeAdvertisement(url: string) {
  return /(?:^|[\W_])(?:ads?|advert|promo|preroll)(?:[\W_]|$)/i.test(url);
}
