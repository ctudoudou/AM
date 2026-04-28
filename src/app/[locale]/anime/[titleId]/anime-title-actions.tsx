"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ImageOff, Loader2, RefreshCw, WandSparkles } from "lucide-react";
import { getMessages } from "@/messages";
import type { Locale } from "@/lib/i18n";

type MetadataAction = "refreshMetadata" | "clearMetadata" | "rebuildTitleFromEpisodes";

export function AnimeTitleActions({
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
      const response = await fetch(`/api/library/anime/${titleId}/repair`, {
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
        onClick={() => void runAction("rebuildTitleFromEpisodes")}
        type="button"
      >
        {busyAction === "rebuildTitleFromEpisodes" ? (
          <Loader2 size={14} />
        ) : (
          <WandSparkles size={14} />
        )}
        {t.rebuildTitleFromEpisodes}
      </button>
      {message ? <small>{message}</small> : null}
    </div>
  );
}
