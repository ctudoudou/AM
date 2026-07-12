import type { MediaType } from "@prisma/client";
import { mergeDuplicateMediaTitles, normalizeMediaPrimaryTitles } from "@/lib/media-title-repair";
import { refreshMediaLibraryMetadata } from "@/lib/metadata";

export async function repairMediaLibrary(mediaType: Extract<MediaType, "MOVIE" | "TV">) {
  const normalized = await normalizeMediaPrimaryTitles(mediaType);
  const merged = await mergeDuplicateMediaTitles(mediaType);
  const metadata = await refreshMediaLibraryMetadata({ mediaType, onlyMissing: true });
  return { mediaType, normalized, merged, metadata };
}
