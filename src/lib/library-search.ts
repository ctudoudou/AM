export type LibrarySearchItem = {
  id: string;
  mediaType: "ANIME" | "MOVIE" | "TV";
  displayTitle: string;
  primaryTitle: string;
  originalTitle?: string | null;
  secondaryTitles?: string[];
  year?: number | null;
  posterUrl?: string | null;
};

export function filterLibrarySearchItems(
  items: LibrarySearchItem[],
  query: string,
  limit = 12,
) {
  const needle = normalizeSearchText(query);
  if (!needle) {
    return [];
  }

  return items
    .map((item) => ({ item, score: matchScore(item, needle) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || compareTitles(left.item, right.item))
    .slice(0, limit)
    .map((entry) => entry.item);
}

function matchScore(item: LibrarySearchItem, needle: string) {
  const titles = [
    item.displayTitle,
    item.primaryTitle,
    item.originalTitle,
    ...(item.secondaryTitles ?? []),
  ]
    .filter((title): title is string => Boolean(title))
    .map(normalizeSearchText);

  if (titles.some((title) => title === needle)) {
    return 3;
  }
  if (titles.some((title) => title.startsWith(needle))) {
    return 2;
  }
  return titles.some((title) => title.includes(needle)) ? 1 : 0;
}

function compareTitles(left: LibrarySearchItem, right: LibrarySearchItem) {
  return left.displayTitle.localeCompare(right.displayTitle);
}

function normalizeSearchText(value: string) {
  return value.trim().toLocaleLowerCase();
}
