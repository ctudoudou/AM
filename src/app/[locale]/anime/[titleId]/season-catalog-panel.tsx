"use client";

import { useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { getMessages } from "@/messages";

type SeasonCatalogRow = {
  id?: string;
  seasonNumber: number;
  episodeCount: number;
  absoluteStart: number | null;
  absoluteEnd: number | null;
  provider?: string;
  sourceUrl?: string | null;
  confidence?: number;
};

type SeasonCatalogDraft = {
  id?: string;
  seasonNumber: string;
  episodeCount: string;
  absoluteStart: string;
  absoluteEnd: string;
  sourceUrl: string;
};

export function SeasonCatalogPanel({
  initialEntries,
  locale,
  mediaTitleId,
}: {
  initialEntries: SeasonCatalogRow[];
  locale: Locale;
  mediaTitleId: string;
}) {
  const t = getMessages(locale);
  const [rows, setRows] = useState<SeasonCatalogDraft[]>(
    initialEntries
      .filter((entry) => (entry.provider ?? "manual") === "manual")
      .map(toDraft),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function saveCatalog() {
    setSaving(true);
    setError("");
    try {
      const entries = rows
        .map((row) => ({
          seasonNumber: Number(row.seasonNumber),
          episodeCount: Number(row.episodeCount),
          absoluteStart: row.absoluteStart.trim() ? Number(row.absoluteStart) : null,
          absoluteEnd: row.absoluteEnd.trim() ? Number(row.absoluteEnd) : null,
          sourceUrl: row.sourceUrl.trim() || null,
        }))
        .filter((row) => row.seasonNumber > 0 && row.episodeCount > 0);
      const response = await fetch(`/api/library/anime/${mediaTitleId}/season-catalog`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "manual", entries }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message || body?.issues?.[0]?.message || t.settingsSaveError);
      }
      window.location.reload();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t.settingsSaveError);
    } finally {
      setSaving(false);
    }
  }

  function updateRow(index: number, patch: Partial<SeasonCatalogDraft>) {
    setRows((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
    );
  }

  return (
    <section className="settings-panel wide">
      <div className="settings-panel-heading">
        <div>
          <h2>{t.seasonCatalog}</h2>
          <p>{t.seasonCatalogDescription}</p>
        </div>
        <div className="toolbar-actions">
          <button
            onClick={() =>
              setRows((current) => [
                ...current,
                {
                  seasonNumber: String((current.at(-1) ? Number(current.at(-1)?.seasonNumber) : 0) + 1),
                  episodeCount: "",
                  absoluteStart: "",
                  absoluteEnd: "",
                  sourceUrl: "",
                },
              ])
            }
            type="button"
          >
            <Plus size={14} />
            {t.addSeasonCatalog}
          </button>
          <button disabled={saving} onClick={() => void saveCatalog()} type="button">
            <Save size={14} />
            {t.save}
          </button>
        </div>
      </div>
      {error ? <div className="settings-alert">{error}</div> : null}
      <div className="field-grid">
        {rows.map((row, index) => (
          <div className="catalog-row" key={row.id ?? index}>
            <label>
              <span>{t.seasons}</span>
              <input
                min={1}
                onChange={(event) => updateRow(index, { seasonNumber: event.target.value })}
                type="number"
                value={row.seasonNumber}
              />
            </label>
            <label>
              <span>{t.seasonCatalogEpisodeCount}</span>
              <input
                min={1}
                onChange={(event) => updateRow(index, { episodeCount: event.target.value })}
                type="number"
                value={row.episodeCount}
              />
            </label>
            <label>
              <span>{t.seasonCatalogAbsoluteStart}</span>
              <input
                min={1}
                onChange={(event) => updateRow(index, { absoluteStart: event.target.value })}
                type="number"
                value={row.absoluteStart}
              />
            </label>
            <label>
              <span>{t.seasonCatalogAbsoluteEnd}</span>
              <input
                min={1}
                onChange={(event) => updateRow(index, { absoluteEnd: event.target.value })}
                type="number"
                value={row.absoluteEnd}
              />
            </label>
            <label>
              <span>{t.seasonCatalogSourceUrl}</span>
              <input
                onChange={(event) => updateRow(index, { sourceUrl: event.target.value })}
                value={row.sourceUrl}
              />
            </label>
            <button
              className="icon-button"
              onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}
              type="button"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function toDraft(row: SeasonCatalogRow): SeasonCatalogDraft {
  return {
    id: row.id,
    seasonNumber: String(row.seasonNumber),
    episodeCount: String(row.episodeCount),
    absoluteStart: row.absoluteStart ? String(row.absoluteStart) : "",
    absoluteEnd: row.absoluteEnd ? String(row.absoluteEnd) : "",
    sourceUrl: row.sourceUrl ?? "",
  };
}
