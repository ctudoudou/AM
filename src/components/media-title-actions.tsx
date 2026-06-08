"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ImageOff, Loader2, Plus, RefreshCw, WandSparkles } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { getMessages } from "@/messages";

type MetadataAction =
  | "refreshMetadata"
  | "clearMetadata"
  | "rebuildTitleFromFiles"
  | "addAliasAndRefresh";

export function MediaTitleActions({
  locale,
  titleId,
}: {
  locale: Locale;
  titleId: string;
}) {
  const t = getMessages(locale);
  const router = useRouter();
  const [busyAction, setBusyAction] = useState<MetadataAction | null>(null);
  const [alias, setAlias] = useState("");
  const [message, setMessage] = useState("");

  async function runAction(action: MetadataAction) {
    setBusyAction(action);
    setMessage("");
    try {
      const response = await fetch(`/api/library/media/${titleId}/repair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) {
        throw new Error(t.metadataActionError);
      }
      setMessage(t.metadataActionDone);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.metadataActionError);
    } finally {
      setBusyAction(null);
    }
  }

  async function addAliasAndRefresh() {
    const trimmedAlias = alias.trim();
    if (!trimmedAlias) {
      return;
    }
    setBusyAction("addAliasAndRefresh");
    setMessage("");
    try {
      const response = await fetch(`/api/library/media/${titleId}/repair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "addAliasAndRefresh", alias: trimmedAlias }),
      });
      if (!response.ok) {
        throw new Error(t.metadataActionError);
      }
      const result = await response.json();
      setAlias("");
      setMessage(
        result?.metadata?.updated || result?.metadata?.provider
          ? t.metadataActionDone
          : t.metadataAliasNoMatch,
      );
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.metadataActionError);
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="anime-metadata-actions">
      <button
        disabled={busyAction !== null}
        onClick={() => void runAction("refreshMetadata")}
        type="button"
      >
        {busyAction === "refreshMetadata" ? <Loader2 size={14} /> : <RefreshCw size={14} />}
        {t.refreshMetadata}
      </button>
      <button
        disabled={busyAction !== null}
        onClick={() => void runAction("clearMetadata")}
        type="button"
      >
        {busyAction === "clearMetadata" ? <Loader2 size={14} /> : <ImageOff size={14} />}
        {t.clearMetadata}
      </button>
      <button
        disabled={busyAction !== null}
        onClick={() => void runAction("rebuildTitleFromFiles")}
        type="button"
      >
        {busyAction === "rebuildTitleFromFiles" ? <Loader2 size={14} /> : <WandSparkles size={14} />}
        {t.rebuildTitleFromFiles}
      </button>
      <form
        className="metadata-alias-form"
        onSubmit={(event) => {
          event.preventDefault();
          void addAliasAndRefresh();
        }}
      >
        <input
          aria-label={t.manualMetadataAlias}
          disabled={busyAction !== null}
          onChange={(event) => setAlias(event.target.value)}
          placeholder={t.manualMetadataAliasPlaceholder}
          type="text"
          value={alias}
        />
        <button disabled={busyAction !== null || !alias.trim()} type="submit">
          {busyAction === "addAliasAndRefresh" ? <Loader2 size={14} /> : <Plus size={14} />}
          {t.addMetadataAlias}
        </button>
      </form>
      {message ? <span>{message}</span> : null}
    </div>
  );
}
