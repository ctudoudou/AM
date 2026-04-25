import { XMLParser } from "fast-xml-parser";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parseAnimeReleaseTitle } from "@/lib/anime-parser";

type FeedItem = {
  title: unknown;
  link?: unknown;
  guid?: unknown;
  pubDate?: string;
  isoDate?: string;
  enclosure?: unknown;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

export async function fetchRssSource(sourceId: string) {
  const source = await prisma.rssSource.findUniqueOrThrow({
    where: { id: sourceId },
  });

  if (!source.enabled) {
    return { created: 0, skipped: 0 };
  }

  const response = await fetch(source.url, {
    headers: { "User-Agent": "Kura/0.1 RSS Fetcher" },
  });

  if (!response.ok) {
    throw new Error(`RSS fetch failed: ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  const parsed = parser.parse(xml);
  const rawItems = normalizeFeedItems(parsed);
  let created = 0;
  let skipped = 0;

  for (const item of rawItems) {
    const title = normalizeText(item.title);
    if (!title) {
      skipped += 1;
      continue;
    }

    const magnetUrl = extractMagnet(item);
    const torrentUrl = extractTorrentUrl(item);
    const link = extractPrimaryLink(item) ?? magnetUrl ?? torrentUrl;
    const guid = normalizeText(item.guid) || link || stableGuid(title);
    const publishedAt = parseDate(item.isoDate || item.pubDate);

    const existing = await prisma.rssItem.findFirst({
      where: {
        sourceId: source.id,
        OR: [{ guid }, ...(link ? [{ link }] : [])],
      },
      select: { id: true },
    });

    if (existing) {
      skipped += 1;
      continue;
    }

    await prisma.rssItem.create({
      data: {
        source: { connect: { id: source.id } },
        origin: "rss",
        guid,
        title,
        link,
        magnetUrl,
        torrentUrl,
        publishedAt,
        raw: item as Prisma.InputJsonValue,
      },
    });
    created += 1;
  }

  return { created, skipped };
}

export async function fetchAllRssSources() {
  const sources = await prisma.rssSource.findMany({
    where: { enabled: true },
    select: { id: true },
  });
  const results = [];

  for (const source of sources) {
    results.push({ sourceId: source.id, ...(await fetchRssSource(source.id)) });
  }

  return results;
}

export async function parseNewRssItems(limit = 100) {
  const items = await prisma.rssItem.findMany({
    where: { status: "NEW" },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  let parsedCount = 0;

  for (const item of items) {
    try {
      const parsed = parseAnimeReleaseTitle(item.title);
      await prisma.releaseCandidate.upsert({
        where: { rssItemId: item.id },
        create: {
          rssItem: { connect: { id: item.id } },
          rawTitle: item.title,
          parsedTitle: parsed.parsedTitle,
          normalizedTitle: parsed.normalizedTitle,
          subtitleGroup: parsed.subtitleGroup,
          episodeNumber: parsed.episodeNumber,
          season: parsed.season,
          resolution: parsed.resolution,
          codec: parsed.codec,
          audio: parsed.audio,
          subtitleLanguage: parsed.subtitleLanguage,
          releaseTags: parsed.releaseTags,
          magnetUrl: item.magnetUrl,
          torrentUrl: item.torrentUrl,
          torrentFilePath: item.torrentFilePath,
          sourceUrl: item.link,
          confidence: parsed.confidence,
          status: parsed.confidence >= 0.7 ? "READY" : "REVIEW",
        },
        update: {
          parsedTitle: parsed.parsedTitle,
          normalizedTitle: parsed.normalizedTitle,
          confidence: parsed.confidence,
          magnetUrl: item.magnetUrl,
          torrentUrl: item.torrentUrl,
          torrentFilePath: item.torrentFilePath,
          sourceUrl: item.link,
          status: parsed.confidence >= 0.7 ? "READY" : "REVIEW",
        },
      });
      await prisma.rssItem.update({
        where: { id: item.id },
        data: { status: "PARSED", parseError: null },
      });
      parsedCount += 1;
    } catch (error) {
      await prisma.rssItem.update({
        where: { id: item.id },
        data: {
          status: "FAILED",
          parseError: error instanceof Error ? error.message : "Parse failed",
        },
      });
    }
  }

  return { parsed: parsedCount };
}

function normalizeFeedItems(parsed: unknown): FeedItem[] {
  const value = parsed as {
    rss?: { channel?: { item?: FeedItem | FeedItem[] } };
    feed?: { entry?: FeedItem | FeedItem[] };
  };
  const items = value.rss?.channel?.item ?? value.feed?.entry ?? [];
  return Array.isArray(items) ? items : [items];
}

function normalizeText(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value && typeof value === "object" && "#text" in value) {
    return String((value as { "#text": unknown })["#text"]).trim();
  }
  if (value && typeof value === "object" && "@_href" in value) {
    return String((value as { "@_href": unknown })["@_href"]).trim();
  }
  if (value && typeof value === "object" && "href" in value) {
    return String((value as { href: unknown }).href).trim();
  }
  if (value && typeof value === "object" && "@_url" in value) {
    return String((value as { "@_url": unknown })["@_url"]).trim();
  }
  if (value && typeof value === "object" && "url" in value) {
    return String((value as { url: unknown }).url).trim();
  }
  return undefined;
}

function extractMagnet(item: FeedItem) {
  return extractLinks(item).find((candidate) => candidate.startsWith("magnet:"));
}

function extractTorrentUrl(item: FeedItem) {
  return extractLinks(item).find((candidate) => isTorrentUrl(candidate));
}

function extractPrimaryLink(item: FeedItem) {
  return extractLinks(item).find((candidate) => !candidate.startsWith("magnet:"));
}

function extractLinks(item: FeedItem) {
  const candidates = [
    ...normalizeUnknownList(item.link),
    item.guid,
    ...normalizeUnknownList(item.enclosure),
  ];
  return candidates
    .map((candidate) => normalizeText(candidate))
    .filter((candidate): candidate is string => Boolean(candidate));
}

function normalizeUnknownList(value: unknown) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function isTorrentUrl(value: string) {
  try {
    const url = new URL(value);
    return url.pathname.toLowerCase().endsWith(".torrent") || url.search.toLowerCase().includes("torrent");
  } catch {
    return value.toLowerCase().includes(".torrent");
  }
}

function parseDate(value?: string) {
  if (!value) {
    return undefined;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp);
}

function stableGuid(value: string) {
  return value.toLowerCase().replace(/\s+/g, "-").slice(0, 180);
}
