"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Film, Loader2, Search, Sparkles, Tv, X } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import {
  filterLibrarySearchItems,
  type LibrarySearchItem,
} from "@/lib/library-search";
import { getMessages } from "@/messages";

type LibraryResponse = {
  titles: Array<Omit<LibrarySearchItem, "mediaType">>;
};

const sources = [
  { mediaType: "ANIME", endpoint: "/api/library/anime", path: "/anime" },
  { mediaType: "MOVIE", endpoint: "/api/library/movies", path: "/movies" },
  { mediaType: "TV", endpoint: "/api/library/tv", path: "/tv" },
] as const;

export function LibrarySearchDialog({ locale }: { locale: Locale }) {
  const t = getMessages(locale);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<LibrarySearchItem[]>([]);
  const results = useMemo(() => filterLibrarySearchItems(items, query), [items, query]);

  const load = useCallback(async () => {
    if (loaded || loading) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const responses = await Promise.all(
        sources.map(async (source) => {
          const response = await fetch(source.endpoint, { cache: "no-store" });
          if (!response.ok) {
            throw new Error(t.globalSearchError);
          }
          const body = (await response.json()) as LibraryResponse;
          return body.titles.map((title) => ({ ...title, mediaType: source.mediaType }));
        }),
      );
      setItems(responses.flat());
      setLoaded(true);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t.globalSearchError);
    } finally {
      setLoading(false);
    }
  }, [loaded, loading, t.globalSearchError]);

  const show = useCallback(() => {
    setOpen(true);
    void load();
  }, [load]);

  const hide = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        show();
      }
      if (event.key === "Escape") {
        hide();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [hide, show]);

  useEffect(() => {
    if (open) {
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  return (
    <>
      <button
        aria-controls="library-search-dialog"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="sidebar-search"
        onClick={show}
        type="button"
      >
        <Search size={14} />
        <span>{t.search}</span>
        <kbd>⌘K</kbd>
      </button>

      {open ? (
        <div
          className="library-search-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              hide();
            }
          }}
        >
          <section
            aria-labelledby="library-search-title"
            aria-modal="true"
            className="library-search-dialog"
            id="library-search-dialog"
            role="dialog"
          >
            <header>
              <div>
                <h2 id="library-search-title">{t.globalSearchTitle}</h2>
                <p>{t.globalSearchDescription}</p>
              </div>
              <button aria-label={t.closeSearch} className="library-search-close" onClick={hide} type="button">
                <X size={16} />
              </button>
            </header>
            <label className="library-search-input">
              <Search size={16} />
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t.globalSearchPlaceholder}
                ref={inputRef}
                value={query}
              />
            </label>

            <div aria-live="polite" className="library-search-results">
              {loading ? (
                <div className="library-search-empty"><Loader2 size={16} />{t.globalSearchLoading}</div>
              ) : error ? (
                <div className="settings-alert">{error}</div>
              ) : !query.trim() ? (
                <div className="library-search-empty">{t.globalSearchHint}</div>
              ) : results.length === 0 ? (
                <div className="library-search-empty">{t.globalSearchNoResults}</div>
              ) : (
                results.map((item) => (
                  <a href={resultHref(locale, item)} key={`${item.mediaType}:${item.id}`} onClick={hide}>
                    <span
                      className="library-search-poster"
                      style={{ backgroundImage: item.posterUrl ? `url(${item.posterUrl})` : undefined }}
                    >
                      {!item.posterUrl ? <MediaTypeIcon type={item.mediaType} /> : null}
                    </span>
                    <span className="library-search-copy">
                      <strong>{item.displayTitle}</strong>
                      <small>{mediaTypeLabel(item.mediaType, t)}{item.year ? ` · ${item.year}` : ""}</small>
                    </span>
                  </a>
                ))
              )}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function resultHref(locale: Locale, item: LibrarySearchItem) {
  const source = sources.find((entry) => entry.mediaType === item.mediaType);
  return `/${locale}${source?.path ?? "/anime"}/${item.id}`;
}

function mediaTypeLabel(type: LibrarySearchItem["mediaType"], t: ReturnType<typeof getMessages>) {
  if (type === "MOVIE") return t.movies;
  if (type === "TV") return t.tv;
  return t.anime;
}

function MediaTypeIcon({ type }: { type: LibrarySearchItem["mediaType"] }) {
  if (type === "MOVIE") return <Film size={18} />;
  if (type === "TV") return <Tv size={18} />;
  return <Sparkles size={18} />;
}
