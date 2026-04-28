"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ImageOff, Loader2, RefreshCw, Save, WandSparkles } from "lucide-react";
import { getMessages } from "@/messages";
import type { Locale } from "@/lib/i18n";

type MetadataAction = "refreshMetadata" | "clearMetadata" | "rebuildTitleFromEpisodes";
type TitleDisplayMode = "GLOBAL" | "ZH_HANT" | "ZH_HANS" | "JA" | "EN" | "CUSTOM";

export function AnimeTitleActions({
  customDisplayTitle,
  locale,
  titleDisplayMode,
  titleId,
}: {
  customDisplayTitle?: string | null;
  locale: Locale;
  titleDisplayMode: TitleDisplayMode;
  titleId: string;
}) {
  const t = getMessages(locale);
  const router = useRouter();
  const [busyAction, setBusyAction] = useState<MetadataAction | null>(null);
  const [savingTitle, setSavingTitle] = useState(false);
  const [mode, setMode] = useState<TitleDisplayMode>(titleDisplayMode);
  const [customTitle, setCustomTitle] = useState(customDisplayTitle ?? "");
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

  async function saveTitleDisplay() {
    setSavingTitle(true);
    setMessage("");
    try {
      const response = await fetch(`/api/library/anime/${titleId}/title-display`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titleDisplayMode: mode,
          customDisplayTitle: customTitle,
        }),
      });
      if (!response.ok) {
        throw new Error(t.titleDisplaySaveError);
      }
      setMessage(t.titleDisplaySaved);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.titleDisplaySaveError);
    } finally {
      setSavingTitle(false);
    }
  }

  return (
    <div className="anime-metadata-actions">
      <select
        aria-label={t.titleDisplayMode}
        onChange={(event) => setMode(event.target.value as TitleDisplayMode)}
        value={mode}
      >
        <option value="GLOBAL">{t.followGlobalTitleDisplay}</option>
        <option value="ZH_HANT">{t.titleZhHant}</option>
        <option value="ZH_HANS">{t.titleZhHans}</option>
        <option value="JA">{t.titleJapanese}</option>
        <option value="EN">{t.titleEnglish}</option>
        <option value="CUSTOM">{t.titleCustom}</option>
      </select>
      {mode === "CUSTOM" ? (
        <input
          onChange={(event) => setCustomTitle(event.target.value)}
          placeholder={t.customDisplayTitle}
          value={customTitle}
        />
      ) : null}
      <button disabled={savingTitle} onClick={() => void saveTitleDisplay()} type="button">
        {savingTitle ? <Loader2 size={14} /> : <Save size={14} />}
        {t.saveTitleDisplay}
      </button>
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
