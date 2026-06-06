import fs from "node:fs/promises";
import path from "node:path";
import {
  addMagnetToAria2,
  addTorrentUrlToAria2,
  removeAria2Download,
  removeAria2DownloadResult,
  tellKnownDownload,
  type Aria2Status,
} from "@/lib/aria2";
import { getAppSettings } from "@/lib/settings";
import type { WantedSearchResult } from "@/lib/wanted-rss-search";

export type TorrentAvailabilityStatus =
  | "available"
  | "reported"
  | "unknown"
  | "unavailable"
  | "not_probeable";

export type TorrentAvailability = {
  status: TorrentAvailabilityStatus;
  source: "aria2" | "index";
  checkedAt: string | null;
  reason: string;
  seeders: number | null;
  connections: number | null;
  downloadSpeed: string | null;
  infoHash: string | null;
  metadataResolved: boolean;
};

const defaultProbeLimit = 5;
const defaultProbeTimeoutMs = 9000;
const probePollIntervalMs = 1200;

type ProbeInput = Pick<WantedSearchResult, "key" | "magnetUrl" | "torrentUrl" | "seeders">;

export async function attachTorrentAvailability<T extends WantedSearchResult>(
  results: T[],
  options: {
    probeLimit?: number;
    probeTimeoutMs?: number;
    shouldProbe?: (result: T) => boolean;
  } = {},
): Promise<Array<T & { availability: TorrentAvailability }>> {
  const annotated = results.map((result) => ({
    ...result,
    availability: indexAvailability(result),
  }));
  const shouldProbe = options.shouldProbe ?? ((result: T) => result.match === "strong");
  const probeInputs = annotated
    .filter((result) => shouldProbe(result) && hasProbeableTorrentSource(result))
    .slice(0, options.probeLimit ?? defaultProbeLimit);

  const probed = await Promise.all(
    probeInputs.map(async (result) => ({
      key: result.key,
      availability: await probeTorrentAvailability(result, {
        timeoutMs: options.probeTimeoutMs ?? defaultProbeTimeoutMs,
      }),
    })),
  );
  const availabilityByKey = new Map(probed.map((item) => [item.key, item.availability]));

  return annotated
    .map((result) => ({
      ...result,
      availability: availabilityByKey.get(result.key) ?? result.availability,
    }))
    .sort(compareResultAvailability);
}

export function indexAvailability(result: Pick<WantedSearchResult, "seeders">): TorrentAvailability {
  if (result.seeders !== null && result.seeders > 0) {
    return {
      status: "reported",
      source: "index",
      checkedAt: null,
      reason: "Index source reported seeders; BT availability has not been probed.",
      seeders: result.seeders,
      connections: null,
      downloadSpeed: null,
      infoHash: null,
      metadataResolved: false,
    };
  }
  return {
    status: "unknown",
    source: "index",
    checkedAt: null,
    reason: "No live BT availability signal yet.",
    seeders: result.seeders,
    connections: null,
    downloadSpeed: null,
    infoHash: null,
    metadataResolved: false,
  };
}

export async function probeTorrentAvailability(
  input: ProbeInput,
  options: { timeoutMs?: number } = {},
): Promise<TorrentAvailability> {
  if (!hasProbeableTorrentSource(input)) {
    return notProbeableAvailability(input.seeders, "No magnet or torrent URL is available.");
  }

  const checkedAt = new Date().toISOString();
  let gid: string | null = null;
  const followedGids = new Set<string>();
  try {
    const settings = await getAppSettings();
    const probeDir = assertInsideRoot(
      path.join(settings.directories.metadataDir, "torrent-probes"),
      settings.directories.metadataDir,
    );
    await fs.mkdir(probeDir, { recursive: true });
    gid = input.magnetUrl
      ? await addMagnetToAria2(input.magnetUrl, probeDir, probeOptions("magnet"))
      : await addTorrentUrlToAria2(input.torrentUrl!, probeDir, probeOptions("torrent"));

    const startedAt = Date.now();
    let latest: Aria2Status | null = null;
    while (Date.now() - startedAt <= (options.timeoutMs ?? defaultProbeTimeoutMs)) {
      await sleep(probePollIntervalMs);
      latest = await tellKnownDownload(gid);
      for (const followed of latest.followedBy ?? []) {
        followedGids.add(followed);
      }
      const classified = classifyAria2ProbeStatus(latest, {
        checkedAt,
        isMagnetProbe: Boolean(input.magnetUrl),
        seeders: input.seeders,
      });
      if (classified.status === "available" || classified.status === "unavailable") {
        return classified;
      }
    }

    return latest
      ? {
          ...classifyAria2ProbeStatus(latest, {
            checkedAt,
            isMagnetProbe: Boolean(input.magnetUrl),
            seeders: input.seeders,
          }),
          status: "unknown",
          reason: "aria2 probe timed out before peer or metadata availability was confirmed.",
        }
      : {
          ...indexAvailability(input),
          source: "aria2",
          checkedAt,
          reason: "aria2 probe did not return a status before timeout.",
        };
  } catch (error) {
    const message = error instanceof Error ? error.message : "aria2 probe failed.";
    const status = message.startsWith("Torrent fetch failed") ? "unavailable" : "not_probeable";
    return {
      status,
      source: "aria2",
      checkedAt,
      reason: message,
      seeders: input.seeders,
      connections: null,
      downloadSpeed: null,
      infoHash: null,
      metadataResolved: false,
    };
  } finally {
    await cleanupProbeTasks([gid, ...followedGids].filter((item): item is string => Boolean(item)));
  }
}

export function classifyAria2ProbeStatus(
  status: Aria2Status,
  input: { checkedAt: string; isMagnetProbe: boolean; seeders: number | null },
): TorrentAvailability {
  const seeders = optionalNumber(status.numSeeders) ?? input.seeders;
  const connections = optionalNumber(status.connections);
  const downloadSpeed = status.downloadSpeed ?? null;
  const infoHash = status.infoHash ?? null;
  const hasVisibleFiles = Boolean(status.files?.some((file) => file.path && file.path !== "[METADATA]"));
  const metadataResolved = Boolean(infoHash || status.bittorrent?.info?.name || hasVisibleFiles);

  if (status.status === "error" || status.status === "removed") {
    return {
      status: "unavailable",
      source: "aria2",
      checkedAt: input.checkedAt,
      reason: status.errorMessage || "aria2 rejected or removed the probe task.",
      seeders,
      connections,
      downloadSpeed,
      infoHash,
      metadataResolved,
    };
  }

  if (connections !== null && connections > 0) {
    return {
      status: "available",
      source: "aria2",
      checkedAt: input.checkedAt,
      reason: "aria2 connected to peers during the probe.",
      seeders,
      connections,
      downloadSpeed,
      infoHash,
      metadataResolved,
    };
  }

  if (optionalNumber(downloadSpeed) !== null && optionalNumber(downloadSpeed)! > 0) {
    return {
      status: "available",
      source: "aria2",
      checkedAt: input.checkedAt,
      reason: "aria2 observed download speed during the probe.",
      seeders,
      connections,
      downloadSpeed,
      infoHash,
      metadataResolved,
    };
  }

  if (input.isMagnetProbe && metadataResolved) {
    return {
      status: "available",
      source: "aria2",
      checkedAt: input.checkedAt,
      reason: "Magnet metadata was resolved during the probe.",
      seeders,
      connections,
      downloadSpeed,
      infoHash,
      metadataResolved,
    };
  }

  return {
    status: seeders !== null && seeders > 0 ? "reported" : "unknown",
    source: status.status === "active" || status.status === "waiting" ? "aria2" : "index",
    checkedAt: input.checkedAt,
    reason:
      seeders !== null && seeders > 0
        ? "Index source reported seeders, but aria2 has not confirmed peers yet."
        : "aria2 has not confirmed peers yet.",
    seeders,
    connections,
    downloadSpeed,
    infoHash,
    metadataResolved,
  };
}

function compareResultAvailability<T extends { match: "strong" | "related"; availability: TorrentAvailability }>(
  a: T,
  b: T,
) {
  const matchDelta = matchScore(b.match) - matchScore(a.match);
  if (matchDelta !== 0) {
    return matchDelta;
  }
  return availabilityScore(b.availability) - availabilityScore(a.availability);
}

function matchScore(match: "strong" | "related") {
  return match === "strong" ? 1 : 0;
}

function availabilityScore(availability: TorrentAvailability) {
  switch (availability.status) {
    case "available":
      return 4;
    case "reported":
      return 3;
    case "unknown":
      return 1;
    case "not_probeable":
      return 0;
    case "unavailable":
      return -2;
  }
}

function hasProbeableTorrentSource(input: Pick<WantedSearchResult, "magnetUrl" | "torrentUrl">) {
  return Boolean(input.magnetUrl || input.torrentUrl);
}

function probeOptions(kind: "magnet" | "torrent") {
  return {
    "bt-save-metadata": "false",
    "check-integrity": "false",
    "max-download-limit": "1K",
    "max-connection-per-server": "1",
    split: "1",
    ...(kind === "magnet" ? { "bt-metadata-only": "true" } : {}),
  };
}

async function cleanupProbeTasks(gids: string[]) {
  await Promise.all(
    [...new Set(gids)].map(async (gid) => {
      await removeAria2Download(gid).catch(() => null);
      await removeAria2DownloadResult(gid).catch(() => null);
    }),
  );
}

function notProbeableAvailability(seeders: number | null, reason: string): TorrentAvailability {
  return {
    status: "not_probeable",
    source: "index",
    checkedAt: null,
    reason,
    seeders,
    connections: null,
    downloadSpeed: null,
    infoHash: null,
    metadataResolved: false,
  };
}

function optionalNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function assertInsideRoot(candidatePath: string, root: string) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidatePath);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Torrent probe directory must stay inside metadata root.");
  }
  return resolvedCandidate;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
