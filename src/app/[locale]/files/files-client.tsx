"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Folder, Loader2, Search } from "lucide-react";
import { getMessages } from "@/messages";
import type { Locale } from "@/lib/i18n";

const roots = [
  "dataRoot",
  "importRoot",
  "downloadsDir",
  "animeLibraryDir",
  "moviesLibraryDir",
  "tvLibraryDir",
  "metadataDir",
  "transcodesDir",
] as const;

type RootKey = (typeof roots)[number];

type FileItem = {
  name: string;
  type: "file" | "directory";
  sizeBytes?: string | null;
  modifiedAt: string;
  extension?: string | null;
  relativePath: string;
};

type FileResponse = {
  root: RootKey;
  path: string;
  parentPath?: string | null;
  items: FileItem[];
};

export function FilesClient({ locale }: { locale: Locale }) {
  const t = getMessages(locale);
  const [root, setRoot] = useState<RootKey>("dataRoot");
  const [currentPath, setCurrentPath] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<FileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const visibleItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!data || !needle) {
      return data?.items ?? [];
    }
    return data.items.filter((item) => item.name.toLowerCase().includes(needle));
  }, [data, query]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ root, path: currentPath });
      const response = await fetch(`/api/files?${params.toString()}`);
      if (!response.ok) {
        throw new Error(t.filesLoadError);
      }
      setData((await response.json()) as FileResponse);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t.filesLoadError);
    } finally {
      setLoading(false);
    }
  }, [currentPath, root, t.filesLoadError]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  function selectRoot(nextRoot: RootKey) {
    setRoot(nextRoot);
    setCurrentPath("");
  }

  const crumbs = currentPath ? currentPath.split("/").filter(Boolean) : [];

  return (
    <section className="settings-panel wide">
      <div className="file-toolbar">
        <select onChange={(event) => selectRoot(event.target.value as RootKey)} value={root}>
          {roots.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <label>
          <Search size={14} />
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.search}
            value={query}
          />
        </label>
      </div>

      <div className="breadcrumb">
        <button onClick={() => setCurrentPath("")} type="button">
          {root}
        </button>
        {crumbs.map((crumb, index) => {
          const path = crumbs.slice(0, index + 1).join("/");
          return (
            <span key={path}>
              <ChevronRight size={13} />
              <button onClick={() => setCurrentPath(path)} type="button">
                {crumb}
              </button>
            </span>
          );
        })}
      </div>

      {error ? <div className="settings-alert">{error}</div> : null}
      {loading ? (
        <div className="settings-loading">
          <Loader2 size={18} />
          {t.loading}
        </div>
      ) : (
        <div className="files-table">
          {visibleItems.length === 0 ? (
            <p>{t.noFiles}</p>
          ) : (
            visibleItems.map((item) => (
              <button
                key={item.relativePath || item.name}
                onClick={() => {
                  if (item.type === "directory") {
                    setCurrentPath(item.relativePath);
                  }
                }}
                type="button"
              >
                <span>
                  <Folder size={15} />
                  <strong>{item.name}</strong>
                </span>
                <small>{item.type === "directory" ? t.folder : item.extension || t.file}</small>
                <small>{item.sizeBytes ? formatBytes(item.sizeBytes) : "-"}</small>
                <small>{new Date(item.modifiedAt).toLocaleString()}</small>
              </button>
            ))
          )}
        </div>
      )}
    </section>
  );
}

function formatBytes(value: string) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
