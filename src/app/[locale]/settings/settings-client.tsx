"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Loader2, Plus, RefreshCw, Save, Trash2, Wifi } from "lucide-react";
import { getMessages } from "@/messages";
import type { Locale } from "@/lib/i18n";

type PublicSettings = {
  directories: DirectorySettings;
  aria2: {
    rpcUrl: string;
    rpcSecretConfigured: boolean;
  };
  ai: {
    provider: "openrouter";
    model: string;
    openRouterApiKeyConfigured: boolean;
  };
  metadataProviders: {
    tmdbApiKeyConfigured: boolean;
    omdbApiKeyConfigured: boolean;
    theTvdbApiKeyConfigured: boolean;
    anidbUsernameConfigured: boolean;
    anidbPasswordConfigured: boolean;
    anidbClientName: string;
    anidbClientVersion: number;
  };
  general: {
    defaultLocale: Locale;
    subscriptionFrequencyMinutes: number;
    animeTitleLanguageOrder: Array<"zh-Hant" | "ja" | "zh-Hans" | "en" | "romaji">;
  };
};

type DirectorySettings = {
  dataRoot: string;
  importRoot: string;
  downloadsDir: string;
  stagingDir: string;
  animeLibraryDir: string;
  moviesLibraryDir: string;
  tvLibraryDir: string;
  metadataDir: string;
  transcodesDir: string;
};

type RssSource = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
};

type AiDebugResult = {
  ok: boolean;
  status?: number;
  model?: string;
  latencyMs?: number;
  message: string;
  hint?: string;
};

type Aria2DebugResult = {
  ok: boolean;
  status?: number;
  version?: string;
  latencyMs?: number;
  message: string;
  hint?: string;
};

type JobRun = {
  id: string;
  job: string;
  status: "SUCCESS" | "FAILED";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  result?: unknown;
  error?: string;
};

const directoryFields = [
  ["dataRoot", "DATA_ROOT"],
  ["importRoot", "IMPORT_ROOT"],
  ["downloadsDir", "DOWNLOADS_DIR"],
  ["stagingDir", "STAGING_DIR"],
  ["animeLibraryDir", "ANIME_LIBRARY_DIR"],
  ["moviesLibraryDir", "MOVIES_LIBRARY_DIR"],
  ["tvLibraryDir", "TV_LIBRARY_DIR"],
  ["metadataDir", "METADATA_DIR"],
  ["transcodesDir", "TRANSCODES_DIR"],
] as const;

export function SettingsClient({ locale }: { locale: Locale }) {
  const t = getMessages(locale);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [rssSources, setRssSources] = useState<RssSource[]>([]);
  const [jobRuns, setJobRuns] = useState<JobRun[]>([]);
  const [rssDraft, setRssDraft] = useState({ name: "", url: "" });
  const [aria2Secret, setAria2Secret] = useState("");
  const [openRouterApiKey, setOpenRouterApiKey] = useState("");
  const [tmdbApiKey, setTmdbApiKey] = useState("");
  const [omdbApiKey, setOmdbApiKey] = useState("");
  const [theTvdbApiKey, setTheTvdbApiKey] = useState("");
  const [anidbUsername, setAnidbUsername] = useState("");
  const [anidbPassword, setAnidbPassword] = useState("");
  const [aria2Debug, setAria2Debug] = useState<Aria2DebugResult | null>(null);
  const [aria2DebugLoading, setAria2DebugLoading] = useState(false);
  const [aiDebug, setAiDebug] = useState<AiDebugResult | null>(null);
  const [aiDebugLoading, setAiDebugLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const configuredSummary = useMemo(() => {
    if (!settings) {
      return "";
    }

    const ai = settings.ai.openRouterApiKeyConfigured ? t.configured : t.notConfigured;
    const aria2 = settings.aria2.rpcSecretConfigured ? t.configured : t.notConfigured;
    const metadata =
      settings.metadataProviders.tmdbApiKeyConfigured ||
      settings.metadataProviders.omdbApiKeyConfigured ||
      settings.metadataProviders.theTvdbApiKeyConfigured ||
      settings.metadataProviders.anidbUsernameConfigured
        ? t.configured
        : t.notConfigured;
    return `OpenRouter: ${ai} · aria2: ${aria2} · Metadata: ${metadata}`;
  }, [settings, t]);

  const load = useCallback(async () => {
    try {
      const [settingsResponse, rssResponse, jobRunsResponse] = await Promise.all([
        fetch("/api/settings"),
        fetch("/api/rss-sources"),
        fetch("/api/jobs/runs?limit=12"),
      ]);

      if (!settingsResponse.ok || !rssResponse.ok || !jobRunsResponse.ok) {
        throw new Error(t.settingsLoadError);
      }

      setSettings(await settingsResponse.json());
      const rssPayload = (await rssResponse.json()) as { sources: RssSource[] };
      setRssSources(rssPayload.sources);
      const jobRunsPayload = (await jobRunsResponse.json()) as { runs: JobRun[] };
      setJobRuns(jobRunsPayload.runs);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t.settingsLoadError);
    } finally {
      setLoading(false);
    }
  }, [t.settingsLoadError]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [load]);

  async function patchSettings(pathName: string, payload: unknown) {
    setStatus("");
    setError("");
    const response = await fetch(`/api/settings/${pathName}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.message || body?.issues?.[0]?.message || t.settingsSaveError);
    }

    setSettings(await response.json());
    setStatus(t.saved);
  }

  async function saveDirectories() {
    if (!settings) {
      return;
    }

    try {
      await patchSettings("directories", settings.directories);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t.settingsSaveError);
    }
  }

  async function saveAria2() {
    if (!settings) {
      return;
    }

    try {
      await patchSettings("aria2", {
        rpcUrl: settings.aria2.rpcUrl,
        ...(aria2Secret.length > 0 ? { rpcSecret: aria2Secret } : {}),
      });
      setAria2Secret("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t.settingsSaveError);
    }
  }

  async function clearAria2Secret() {
    if (!settings) {
      return;
    }

    try {
      await patchSettings("aria2", {
        rpcUrl: settings.aria2.rpcUrl,
        rpcSecret: "",
      });
      setAria2Secret("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t.settingsSaveError);
    }
  }

  async function debugAria2() {
    if (!settings) {
      return;
    }

    setAria2DebugLoading(true);
    setAria2Debug(null);
    setError("");
    try {
      const response = await fetch("/api/settings/aria2/debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rpcUrl: settings.aria2.rpcUrl,
          ...(aria2Secret.length > 0 ? { rpcSecret: aria2Secret } : {}),
        }),
      });
      const body = (await response.json()) as Aria2DebugResult;
      setAria2Debug(body);
    } catch (debugError) {
      setAria2Debug({
        ok: false,
        message: debugError instanceof Error ? debugError.message : t.aria2DebugFailed,
      });
    } finally {
      setAria2DebugLoading(false);
    }
  }

  async function saveAi() {
    if (!settings) {
      return;
    }

    try {
      await patchSettings("ai", {
        model: settings.ai.model,
        ...(openRouterApiKey.length > 0
          ? { openRouterApiKey }
          : {}),
      });
      setOpenRouterApiKey("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t.settingsSaveError);
    }
  }

  async function saveMetadataProviders() {
    if (!settings) {
      return;
    }

    try {
      await patchSettings("metadata-providers", {
        ...(tmdbApiKey.length > 0 ? { tmdbApiKey } : {}),
        ...(omdbApiKey.length > 0 ? { omdbApiKey } : {}),
        ...(theTvdbApiKey.length > 0 ? { theTvdbApiKey } : {}),
        ...(anidbUsername.length > 0 ? { anidbUsername } : {}),
        ...(anidbPassword.length > 0 ? { anidbPassword } : {}),
        anidbClientName: settings.metadataProviders.anidbClientName,
        anidbClientVersion: settings.metadataProviders.anidbClientVersion,
      });
      setTmdbApiKey("");
      setOmdbApiKey("");
      setTheTvdbApiKey("");
      setAnidbUsername("");
      setAnidbPassword("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t.settingsSaveError);
    }
  }

  async function debugAi() {
    if (!settings) {
      return;
    }

    setAiDebugLoading(true);
    setAiDebug(null);
    setError("");
    try {
      const response = await fetch("/api/settings/ai/debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: settings.ai.model,
          ...(openRouterApiKey.length > 0 ? { openRouterApiKey } : {}),
        }),
      });
      const body = (await response.json()) as AiDebugResult;
      setAiDebug(body);
    } catch (debugError) {
      setAiDebug({
        ok: false,
        message: debugError instanceof Error ? debugError.message : t.aiDebugFailed,
      });
    } finally {
      setAiDebugLoading(false);
    }
  }

  async function saveGeneral() {
    if (!settings) {
      return;
    }

    try {
      await patchSettings("general", settings.general);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t.settingsSaveError);
    }
  }

  async function addRssSource() {
    setError("");
    const response = await fetch("/api/rss-sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...rssDraft, enabled: true }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.message || body?.issues?.[0]?.message || t.rssSaveError);
      return;
    }

    const source = (await response.json()) as RssSource;
    setRssDraft({ name: "", url: "" });
    setRssSources((current) => [...current, source]);
  }

  async function toggleRssSource(source: RssSource) {
    const response = await fetch(`/api/rss-sources/${source.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !source.enabled }),
    });

    if (response.ok) {
      await load();
    }
  }

  async function deleteRssSource(source: RssSource) {
    const response = await fetch(`/api/rss-sources/${source.id}`, {
      method: "DELETE",
    });

    if (response.ok) {
      setRssSources((current) => current.filter((item) => item.id !== source.id));
    }
  }

  async function refreshJobRuns() {
    setError("");
    try {
      const response = await fetch("/api/jobs/runs?limit=12");
      if (!response.ok) {
        throw new Error(t.settingsLoadError);
      }
      const payload = (await response.json()) as { runs: JobRun[] };
      setJobRuns(payload.runs);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : t.settingsLoadError);
    }
  }

  if (loading) {
    return (
      <div className="settings-loading">
        <Loader2 size={18} />
        {t.loading}
      </div>
    );
  }

  if (!settings) {
    return <div className="settings-alert">{error || t.settingsLoadError}</div>;
  }

  return (
    <div className="settings-grid">
      <div className="settings-status-row">
        <span>{configuredSummary}</span>
        {status ? (
          <b>
            <Check size={14} />
            {status}
          </b>
        ) : null}
      </div>
      {error ? <div className="settings-alert">{error}</div> : null}

      <section className="settings-panel wide">
        <div className="settings-panel-heading">
          <div>
            <h2>{t.directorySettings}</h2>
            <p>{t.directorySettingsDescription}</p>
          </div>
          <button onClick={saveDirectories} type="button">
            <Save size={14} />
            {t.save}
          </button>
        </div>
        <div className="field-grid">
          {directoryFields.map(([key, label]) => (
            <label key={key}>
              <span>{label}</span>
              <input
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    directories: {
                      ...settings.directories,
                      [key]: event.target.value,
                    },
                  })
                }
                value={settings.directories[key]}
              />
            </label>
          ))}
        </div>
      </section>

      <section className="settings-panel">
        <div className="settings-panel-heading">
          <div>
            <h2>{t.aria2Settings}</h2>
            <p>{t.aria2SettingsDescription}</p>
          </div>
          <div className="toolbar-actions">
            <button disabled={aria2DebugLoading} onClick={debugAria2} type="button">
              {aria2DebugLoading ? <Loader2 size={14} /> : <Wifi size={14} />}
              {t.testConnection}
            </button>
            <button onClick={saveAria2} type="button">
              <Save size={14} />
              {t.save}
            </button>
          </div>
        </div>
        <label>
          <span>RPC URL</span>
          <input
            onChange={(event) =>
              setSettings({
                ...settings,
                aria2: { ...settings.aria2, rpcUrl: event.target.value },
              })
            }
            value={settings.aria2.rpcUrl}
          />
        </label>
        <label>
          <span>{t.rpcSecret}</span>
          <input
            onChange={(event) => setAria2Secret(event.target.value)}
            placeholder={
              settings.aria2.rpcSecretConfigured ? t.secretConfigured : t.secretEmpty
            }
            type="password"
            value={aria2Secret}
          />
        </label>
        {settings.aria2.rpcSecretConfigured ? (
          <button onClick={clearAria2Secret} type="button">
            {t.clearSecret}
          </button>
        ) : null}
        {aria2Debug ? (
          <div className={aria2Debug.ok ? "settings-status-row ai-debug" : "settings-alert"}>
            <span>
              {aria2Debug.ok ? t.aria2DebugOk : t.aria2DebugFailed}:{" "}
              {aria2Debug.message}
              {aria2Debug.latencyMs ? ` · ${aria2Debug.latencyMs}ms` : ""}
              {aria2Debug.status ? ` · HTTP ${aria2Debug.status}` : ""}
            </span>
            {aria2Debug.hint ? <small>{aria2Debug.hint}</small> : null}
          </div>
        ) : null}
      </section>

      <section className="settings-panel">
        <div className="settings-panel-heading">
          <div>
            <h2>{t.metadataProviderSettings}</h2>
            <p>{t.metadataProviderSettingsDescription}</p>
          </div>
          <button onClick={saveMetadataProviders} type="button">
            <Save size={14} />
            {t.save}
          </button>
        </div>
        <label>
          <span>TMDB API Key</span>
          <input
            onChange={(event) => setTmdbApiKey(event.target.value)}
            placeholder={
              settings.metadataProviders.tmdbApiKeyConfigured
                ? t.secretConfigured
                : t.secretEmpty
            }
            type="password"
            value={tmdbApiKey}
          />
        </label>
        <label>
          <span>OMDB API Key</span>
          <input
            onChange={(event) => setOmdbApiKey(event.target.value)}
            placeholder={
              settings.metadataProviders.omdbApiKeyConfigured
                ? t.secretConfigured
                : t.secretEmpty
            }
            type="password"
            value={omdbApiKey}
          />
        </label>
        <label>
          <span>TheTVDB API Key</span>
          <input
            onChange={(event) => setTheTvdbApiKey(event.target.value)}
            placeholder={
              settings.metadataProviders.theTvdbApiKeyConfigured
                ? t.secretConfigured
                : t.secretEmpty
            }
            type="password"
            value={theTvdbApiKey}
          />
        </label>
        <label>
          <span>AniDB Username</span>
          <input
            onChange={(event) => setAnidbUsername(event.target.value)}
            placeholder={
              settings.metadataProviders.anidbUsernameConfigured
                ? t.secretConfigured
                : t.secretEmpty
            }
            value={anidbUsername}
          />
        </label>
        <label>
          <span>AniDB Password</span>
          <input
            onChange={(event) => setAnidbPassword(event.target.value)}
            placeholder={
              settings.metadataProviders.anidbPasswordConfigured
                ? t.secretConfigured
                : t.secretEmpty
            }
            type="password"
            value={anidbPassword}
          />
        </label>
        <label>
          <span>AniDB Client Name</span>
          <input
            onChange={(event) =>
              setSettings({
                ...settings,
                metadataProviders: {
                  ...settings.metadataProviders,
                  anidbClientName: event.target.value,
                },
              })
            }
            placeholder="kura"
            value={settings.metadataProviders.anidbClientName}
          />
        </label>
        <label>
          <span>AniDB Client Version</span>
          <input
            min={1}
            onChange={(event) =>
              setSettings({
                ...settings,
                metadataProviders: {
                  ...settings.metadataProviders,
                  anidbClientVersion: Number(event.target.value),
                },
              })
            }
            type="number"
            value={settings.metadataProviders.anidbClientVersion}
          />
        </label>
      </section>

      <section className="settings-panel">
        <div className="settings-panel-heading">
          <div>
            <h2>{t.aiSettings}</h2>
            <p>{t.aiSettingsDescription}</p>
          </div>
          <div className="toolbar-actions">
            <button disabled={aiDebugLoading} onClick={debugAi} type="button">
              {aiDebugLoading ? <Loader2 size={14} /> : <Wifi size={14} />}
              {t.testConnection}
            </button>
            <button onClick={saveAi} type="button">
              <Save size={14} />
              {t.save}
            </button>
          </div>
        </div>
        <label>
          <span>OpenRouter API Key</span>
          <input
            onChange={(event) => setOpenRouterApiKey(event.target.value)}
            placeholder={
              settings.ai.openRouterApiKeyConfigured ? t.secretConfigured : t.secretEmpty
            }
            type="password"
            value={openRouterApiKey}
          />
        </label>
        <label>
          <span>{t.model}</span>
          <input
            onChange={(event) =>
              setSettings({
                ...settings,
                ai: { ...settings.ai, model: event.target.value },
              })
            }
            value={settings.ai.model}
          />
        </label>
        {aiDebug ? (
          <div className={aiDebug.ok ? "settings-status-row ai-debug" : "settings-alert"}>
            <span>
              {aiDebug.ok ? t.aiDebugOk : t.aiDebugFailed}: {aiDebug.message}
              {aiDebug.latencyMs ? ` · ${aiDebug.latencyMs}ms` : ""}
              {aiDebug.status ? ` · HTTP ${aiDebug.status}` : ""}
            </span>
            {aiDebug.hint ? <small>{aiDebug.hint}</small> : null}
          </div>
        ) : null}
      </section>

      <section className="settings-panel">
        <div className="settings-panel-heading">
          <div>
            <h2>{t.generalSettings}</h2>
            <p>{t.generalSettingsDescription}</p>
          </div>
          <button onClick={saveGeneral} type="button">
            <Save size={14} />
            {t.save}
          </button>
        </div>
        <label>
          <span>{t.language}</span>
          <select
            onChange={(event) =>
              setSettings({
                ...settings,
                general: {
                  ...settings.general,
                  defaultLocale: event.target.value as Locale,
                },
              })
            }
            value={settings.general.defaultLocale}
          >
            <option value="zh-Hans">简体中文</option>
            <option value="zh-Hant">繁體中文</option>
            <option value="en">English</option>
          </select>
        </label>
        <label>
          <span>{t.subscriptionFrequency}</span>
          <input
            min={5}
            onChange={(event) =>
              setSettings({
                ...settings,
                general: {
                  ...settings.general,
                  subscriptionFrequencyMinutes: Number(event.target.value),
                },
              })
            }
            type="number"
            value={settings.general.subscriptionFrequencyMinutes}
          />
        </label>
        <label>
          <span>{t.animeTitleLanguageOrder}</span>
          <select
            onChange={(event) =>
              setSettings({
                ...settings,
                general: {
                  ...settings.general,
                  animeTitleLanguageOrder: titleOrderPreset(event.target.value),
                },
              })
            }
            value={titleOrderPresetKey(settings.general.animeTitleLanguageOrder)}
          >
            <option value="zhHantFirst">{t.titleOrderZhHantFirst}</option>
            <option value="zhHansFirst">{t.titleOrderZhHansFirst}</option>
            <option value="jaFirst">{t.titleOrderJaFirst}</option>
            <option value="enFirst">{t.titleOrderEnFirst}</option>
          </select>
        </label>
      </section>

      <section className="settings-panel wide">
        <div className="settings-panel-heading">
          <div>
            <h2>{t.rssSources}</h2>
            <p>{t.rssSourcesDescription}</p>
          </div>
        </div>
        <div className="rss-draft">
          <input
            onChange={(event) =>
              setRssDraft({ ...rssDraft, name: event.target.value })
            }
            placeholder={t.rssName}
            value={rssDraft.name}
          />
          <input
            onChange={(event) =>
              setRssDraft({ ...rssDraft, url: event.target.value })
            }
            placeholder={t.rssUrl}
            value={rssDraft.url}
          />
          <button onClick={addRssSource} type="button">
            <Plus size={14} />
            {t.add}
          </button>
        </div>
        <div className="rss-list">
          {rssSources.length === 0 ? (
            <p>{t.noRssSources}</p>
          ) : (
            rssSources.map((source) => (
              <article key={source.id}>
                <button
                  className={source.enabled ? "toggle active" : "toggle"}
                  onClick={() => void toggleRssSource(source)}
                  type="button"
                >
                  {source.enabled ? t.enabled : t.disabled}
                </button>
                <div>
                  <h3>{source.name}</h3>
                  <p>{source.url}</p>
                </div>
                <button
                  className="icon-button"
                  onClick={() => void deleteRssSource(source)}
                  type="button"
                >
                  <Trash2 size={14} />
                </button>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="settings-panel wide">
        <div className="settings-panel-heading">
          <div>
            <h2>{t.jobRuns}</h2>
            <p>{t.jobRunsDescription}</p>
          </div>
          <button onClick={() => void refreshJobRuns()} type="button">
            <RefreshCw size={14} />
            {t.refresh}
          </button>
        </div>
        <div className="job-run-list">
          {jobRuns.length === 0 ? (
            <p>{t.noJobRuns}</p>
          ) : (
            jobRuns.map((run) => (
              <article className={run.status === "SUCCESS" ? "success" : "failed"} key={run.id}>
                <div>
                  <strong>{run.job}</strong>
                  <small>
                    {new Date(run.finishedAt).toLocaleString()} · {run.durationMs}ms
                  </small>
                </div>
                <span>{run.status === "SUCCESS" ? t.jobStatusSuccess : t.jobStatusFailed}</span>
                {run.error ? <em>{run.error}</em> : null}
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

type TitleLanguage = PublicSettings["general"]["animeTitleLanguageOrder"][number];

function titleOrderPreset(value: string): TitleLanguage[] {
  if (value === "zhHansFirst") {
    return ["zh-Hans", "zh-Hant", "ja", "en", "romaji"];
  }
  if (value === "jaFirst") {
    return ["ja", "zh-Hant", "zh-Hans", "en", "romaji"];
  }
  if (value === "enFirst") {
    return ["en", "zh-Hant", "ja", "zh-Hans", "romaji"];
  }
  return ["zh-Hant", "ja", "zh-Hans", "en", "romaji"];
}

function titleOrderPresetKey(order: TitleLanguage[]) {
  const key = order.join(",");
  if (key === "zh-Hans,zh-Hant,ja,en,romaji") {
    return "zhHansFirst";
  }
  if (key === "ja,zh-Hant,zh-Hans,en,romaji") {
    return "jaFirst";
  }
  if (key === "en,zh-Hant,ja,zh-Hans,romaji") {
    return "enFirst";
  }
  return "zhHantFirst";
}
