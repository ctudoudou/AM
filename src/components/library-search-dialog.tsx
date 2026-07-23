"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function resolveDialogTabTarget(
  focusableElements: HTMLElement[],
  activeElement: Element | null,
  shiftKey: boolean,
) {
  if (focusableElements.length === 0) {
    return null;
  }

  const activeIndex = focusableElements.indexOf(activeElement as HTMLElement);
  if (shiftKey && activeIndex <= 0) {
    return focusableElements.at(-1) ?? null;
  }
  if (!shiftKey && (activeIndex === -1 || activeIndex === focusableElements.length - 1)) {
    return focusableElements[0] ?? null;
  }
  return null;
}

export function restoreDialogTrigger(trigger: Pick<HTMLElement, "focus" | "isConnected"> | null) {
  if (!trigger?.isConnected) {
    return false;
  }
  trigger.focus();
  return true;
}

export function LibrarySearchDialog({ locale }: { locale: Locale }) {
  const t = getMessages(locale);
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
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
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [show]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const trigger = triggerRef.current;
    const backgroundElement = trigger?.closest<HTMLElement>(".app-shell") ?? null;
    const backgroundState = backgroundElement ? {
      ariaHidden: backgroundElement.getAttribute("aria-hidden"),
      inert: backgroundElement.inert,
    } : null;

    inputRef.current?.focus();
    document.body.style.overflow = "hidden";
    if (backgroundElement) {
      backgroundElement.inert = true;
      backgroundElement.setAttribute("aria-hidden", "true");
    }

    const handleDialogKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        hide();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
      ).filter((element) => element.getClientRects().length > 0);
      const target = resolveDialogTabTarget(focusableElements, document.activeElement, event.shiftKey);
      if (target) {
        event.preventDefault();
        target.focus();
      }
    };

    window.addEventListener("keydown", handleDialogKeydown, true);
    return () => {
      window.removeEventListener("keydown", handleDialogKeydown, true);
      document.body.style.overflow = previousOverflow;
      if (backgroundElement && backgroundState) {
        backgroundElement.inert = backgroundState.inert;
        if (backgroundState.ariaHidden === null) {
          backgroundElement.removeAttribute("aria-hidden");
        } else {
          backgroundElement.setAttribute("aria-hidden", backgroundState.ariaHidden);
        }
      }
      window.requestAnimationFrame(() => restoreDialogTrigger(trigger));
    };
  }, [hide, open]);

  return (
    <>
      <button
        aria-controls="library-search-dialog"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="sidebar-search"
        onClick={show}
        ref={triggerRef}
        type="button"
      >
        <Search size={14} />
        <span>{t.search}</span>
        <kbd>⌘K</kbd>
      </button>

      {open && typeof document !== "undefined" ? createPortal(
        <div
          className="library-search-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              hide();
            }
          }}
        >
          <section
            aria-describedby="library-search-description"
            aria-labelledby="library-search-title"
            aria-modal="true"
            className="library-search-dialog"
            id="library-search-dialog"
            ref={dialogRef}
            role="dialog"
          >
            <header>
              <div>
                <h2 id="library-search-title">{t.globalSearchTitle}</h2>
                <p id="library-search-description">{t.globalSearchDescription}</p>
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
                type="search"
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
        </div>,
        document.body,
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
