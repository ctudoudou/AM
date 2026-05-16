"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ImageOff, Loader2, RefreshCw, WandSparkles } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { getMessages } from "@/messages";

type MetadataAction = "refreshMetadata" | "clearMetadata" | "rebuildTitleFromFiles";

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
        {t.rebuildTitle}
      </button>
      {message ? <span>{message}</span> : null}
    </div>
  );
}
