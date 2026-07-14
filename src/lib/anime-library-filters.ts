export type AnimeLibraryFilterState = {
  query: string;
  year: string;
  tag: string;
  sort: string;
};

export const defaultAnimeLibraryFilters: AnimeLibraryFilterState = {
  query: "",
  year: "ALL",
  tag: "ALL",
  sort: "UPDATED_DESC",
};

export function readAnimeLibraryFilters(search: string): AnimeLibraryFilterState {
  const params = new URLSearchParams(search);
  return {
    query: params.get("q") ?? defaultAnimeLibraryFilters.query,
    year: params.get("year") ?? defaultAnimeLibraryFilters.year,
    tag: params.get("tag") ?? defaultAnimeLibraryFilters.tag,
    sort: params.get("sort") ?? defaultAnimeLibraryFilters.sort,
  };
}

export function writeAnimeLibraryFilters(search: string, state: AnimeLibraryFilterState) {
  const params = new URLSearchParams(search);
  setOrDelete(params, "q", state.query.trim(), defaultAnimeLibraryFilters.query);
  setOrDelete(params, "year", state.year, defaultAnimeLibraryFilters.year);
  setOrDelete(params, "tag", state.tag, defaultAnimeLibraryFilters.tag);
  setOrDelete(params, "sort", state.sort, defaultAnimeLibraryFilters.sort);
  const value = params.toString();
  return value ? `?${value}` : "";
}

function setOrDelete(params: URLSearchParams, key: string, value: string, defaultValue: string) {
  if (value && value !== defaultValue) {
    params.set(key, value);
  } else {
    params.delete(key);
  }
}
