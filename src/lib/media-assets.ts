import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { getAppSettings } from "@/lib/settings";

const imageContentTypes = new Map([
  [".avif", "image/avif"],
  [".gif", "image/gif"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

const contentTypeExtensions = new Map(
  [...imageContentTypes.entries()].map(([extension, contentType]) => [contentType, extension]),
);

export async function cacheRemoteMediaAsset(
  url: string | null | undefined,
  input: {
    mediaId: string;
    kind: "poster" | "backdrop";
  },
) {
  try {
    if (!url) {
      return undefined;
    }
    if (url.startsWith("/api/media-assets/")) {
      return url;
    }
    if (!/^https?:\/\//i.test(url)) {
      return undefined;
    }

    const response = await fetch(url, {
      headers: { "User-Agent": "Kura/0.1" },
      signal: AbortSignal.timeout(12_000),
    }).catch(() => null);
    if (!response?.ok) {
      return undefined;
    }
    const contentType = response.headers.get("content-type")?.split(";")[0]?.toLowerCase();
    const extension = extensionForAsset(url, contentType);
    if (!extension || !imageContentTypes.has(extension)) {
      return undefined;
    }

    const settings = await getAppSettings();
    const root = path.join(settings.directories.metadataDir, "covers");
    await fs.mkdir(root, { recursive: true });
    const filename = `${safeSegment(input.mediaId)}-${input.kind}${extension}`;
    const filePath = path.join(root, filename);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0) {
      return undefined;
    }
    await fs.writeFile(filePath, bytes);
    return `/api/media-assets/covers/${filename}`;
  } catch {
    return undefined;
  }
}

export function isLocalMediaAssetUrl(url: string | null | undefined) {
  return Boolean(url?.startsWith("/api/media-assets/"));
}

export async function localMediaAssetExists(url: string | null | undefined) {
  if (!isLocalMediaAssetUrl(url)) {
    return false;
  }
  try {
    const assetPath = url!.slice("/api/media-assets/".length).split("/").filter(Boolean);
    const settings = await getAppSettings();
    const metadataRoot = path.resolve(settings.directories.metadataDir);
    const filePath = assertInsideRoot(path.join(metadataRoot, ...assetPath), metadataRoot);
    return imageContentTypes.has(path.extname(filePath).toLowerCase()) && exists(filePath);
  } catch {
    return false;
  }
}

export async function createMediaAssetResponse(assetPath: string[]) {
  const settings = await getAppSettings();
  const metadataRoot = path.resolve(settings.directories.metadataDir);
  const filePath = assertInsideRoot(path.join(metadataRoot, ...assetPath), metadataRoot);
  const extension = path.extname(filePath).toLowerCase();
  const contentType = imageContentTypes.get(extension);
  if (!contentType || !(await exists(filePath))) {
    return new Response("Asset not found", { status: 404 });
  }
  const stream = createReadStream(filePath);
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": contentType,
    },
  });
}

function extensionForAsset(url: string, contentType: string | undefined) {
  const fromType = contentType ? contentTypeExtensions.get(contentType) : undefined;
  if (fromType) {
    return fromType;
  }
  const extension = path.extname(new URL(url).pathname).toLowerCase();
  return imageContentTypes.has(extension) ? extension : undefined;
}

function assertInsideRoot(candidatePath: string, root: string) {
  const resolved = path.resolve(candidatePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Asset path is outside configured metadata root.");
  }
  return resolved;
}

async function exists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}
