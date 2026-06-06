import path from "node:path";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { locales, type Locale } from "@/lib/i18n";
import { prisma } from "@/lib/db";
import { serverEnv } from "@/lib/env";

const SETTINGS_KEY = "app";

const localeSchema = z.enum(locales);
const titleLanguageSchema = z.enum(["zh-Hant", "ja", "zh-Hans", "en", "romaji"]);

const absolutePathSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !value.includes("\0"), "Path cannot contain null bytes")
  .refine((value) => path.isAbsolute(value), "Path must be absolute")
  .transform((value) => path.resolve(value));

const directorySettingsObjectSchema = z.object({
    dataRoot: absolutePathSchema,
    importRoot: absolutePathSchema.default(serverEnv.IMPORT_ROOT),
    downloadsDir: absolutePathSchema,
    stagingDir: absolutePathSchema,
    animeLibraryDir: absolutePathSchema,
    moviesLibraryDir: absolutePathSchema,
    tvLibraryDir: absolutePathSchema,
    metadataDir: absolutePathSchema,
    transcodesDir: absolutePathSchema,
  });

export const directorySettingsSchema = directorySettingsObjectSchema
  .superRefine((value, context) => {
    const dataRoot = path.resolve(value.dataRoot);
    const entries = Object.entries(value).filter(([key]) => key !== "dataRoot");

    for (const [key, candidate] of entries) {
      const resolved = path.resolve(candidate);
      if (resolved !== dataRoot && !resolved.startsWith(`${dataRoot}${path.sep}`)) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: "Directory must be inside DATA_ROOT",
        });
      }
    }
  });

export const aria2SettingsSchema = z.object({
  rpcUrl: z.string().trim().url(),
  rpcSecret: z.string(),
});

export const aiSettingsSchema = z.object({
  provider: z.literal("openrouter"),
  openRouterApiKey: z.string(),
  model: z.string().trim().min(1),
});

export const metadataProviderSettingsSchema = z.object({
  tmdbApiKey: z.string(),
  omdbApiKey: z.string(),
  theTvdbApiKey: z.string(),
  anidbUsername: z.string(),
  anidbPassword: z.string(),
  anidbClientName: z
    .string()
    .trim()
    .refine(
      (value) => value.length === 0 || /^[a-z]{4,16}$/.test(value),
      "AniDB client name must be 4-16 lowercase letters",
    ),
  anidbClientVersion: z.coerce.number().int().positive().max(9999),
});

export const generalSettingsSchema = z.object({
  defaultLocale: localeSchema,
  subscriptionFrequencyMinutes: z.coerce.number().int().min(5).max(10_080),
  animeTitleLanguageOrder: z
    .array(titleLanguageSchema)
    .min(1)
    .default(["zh-Hant", "ja", "zh-Hans", "en", "romaji"]),
});

export const appSettingsSchema = z.object({
  directories: directorySettingsSchema,
  aria2: aria2SettingsSchema,
  ai: aiSettingsSchema,
  metadataProviders: metadataProviderSettingsSchema,
  general: generalSettingsSchema,
});

export type AppSettings = z.infer<typeof appSettingsSchema>;
export type PublicAppSettings = ReturnType<typeof redactAppSettings>;

export const directorySettingsPatchSchema = directorySettingsObjectSchema.partial();
export const aria2SettingsPatchSchema = z.object({
  rpcUrl: z.string().trim().url().optional(),
  rpcSecret: z.string().optional(),
});
export const aiSettingsPatchSchema = z.object({
  openRouterApiKey: z.string().optional(),
  model: z.string().trim().min(1).optional(),
});
export const metadataProviderSettingsPatchSchema = z.object({
  tmdbApiKey: z.string().optional(),
  omdbApiKey: z.string().optional(),
  theTvdbApiKey: z.string().optional(),
  anidbUsername: z.string().optional(),
  anidbPassword: z.string().optional(),
  anidbClientName: z.string().trim().optional(),
  anidbClientVersion: z.coerce.number().int().positive().max(9999).optional(),
});
export const generalSettingsPatchSchema = generalSettingsSchema.partial();

const envLocale = process.env.NEXT_PUBLIC_DEFAULT_LOCALE;
const defaultSettingsLocale: Locale =
  envLocale && locales.includes(envLocale as Locale)
    ? (envLocale as Locale)
    : "zh-Hans";

export const defaultAppSettings: AppSettings = appSettingsSchema.parse({
  directories: {
    dataRoot: serverEnv.DATA_ROOT,
    importRoot: serverEnv.IMPORT_ROOT,
    downloadsDir: serverEnv.DOWNLOADS_DIR,
    stagingDir: serverEnv.STAGING_DIR,
    animeLibraryDir: serverEnv.ANIME_LIBRARY_DIR,
    moviesLibraryDir: serverEnv.MOVIES_LIBRARY_DIR,
    tvLibraryDir: serverEnv.TV_LIBRARY_DIR,
    metadataDir: serverEnv.METADATA_DIR,
    transcodesDir: serverEnv.TRANSCODES_DIR,
  },
  aria2: {
    rpcUrl: serverEnv.ARIA2_RPC_URL,
    rpcSecret: serverEnv.ARIA2_RPC_SECRET,
  },
  ai: {
    provider: "openrouter",
    openRouterApiKey: serverEnv.OPENROUTER_API_KEY,
    model: serverEnv.OPENROUTER_MODEL || "glm5.1",
  },
  metadataProviders: {
    tmdbApiKey: serverEnv.TMDB_API_KEY,
    omdbApiKey: serverEnv.OMDB_API_KEY,
    theTvdbApiKey: serverEnv.THETVDB_API_KEY,
    anidbUsername: serverEnv.ANIDB_USERNAME,
    anidbPassword: serverEnv.ANIDB_PASSWORD,
    anidbClientName: serverEnv.ANIDB_CLIENT_NAME,
    anidbClientVersion: serverEnv.ANIDB_CLIENT_VERSION,
  },
  general: {
    defaultLocale: defaultSettingsLocale,
    subscriptionFrequencyMinutes: 30,
    animeTitleLanguageOrder: ["zh-Hant", "ja", "zh-Hans", "en", "romaji"],
  },
});

export function redactAppSettings(settings: AppSettings) {
  return {
    directories: settings.directories,
    aria2: {
      rpcUrl: settings.aria2.rpcUrl,
      rpcSecretConfigured: settings.aria2.rpcSecret.length > 0,
    },
    ai: {
      provider: settings.ai.provider,
      model: settings.ai.model,
      openRouterApiKeyConfigured: settings.ai.openRouterApiKey.length > 0,
    },
    metadataProviders: {
      tmdbApiKeyConfigured: settings.metadataProviders.tmdbApiKey.length > 0,
      omdbApiKeyConfigured: settings.metadataProviders.omdbApiKey.length > 0,
      theTvdbApiKeyConfigured: settings.metadataProviders.theTvdbApiKey.length > 0,
      anidbUsernameConfigured: settings.metadataProviders.anidbUsername.length > 0,
      anidbPasswordConfigured: settings.metadataProviders.anidbPassword.length > 0,
      anidbClientName: settings.metadataProviders.anidbClientName,
      anidbClientVersion: settings.metadataProviders.anidbClientVersion,
    },
    general: settings.general,
  };
}

export async function getAppSettings(): Promise<AppSettings> {
  const row = await prisma.appSetting.findUnique({
    where: { key: SETTINGS_KEY },
  });

  if (!row) {
    return defaultAppSettings;
  }

  const saved = isRecord(row.value) ? row.value : {};
  const parsed = appSettingsSchema.safeParse({
    ...defaultAppSettings,
    ...saved,
    directories: {
      ...defaultAppSettings.directories,
      ...(isRecord(saved.directories) ? saved.directories : {}),
    },
    aria2: {
      ...defaultAppSettings.aria2,
      ...(isRecord(saved.aria2) ? saved.aria2 : {}),
    },
    ai: {
      ...defaultAppSettings.ai,
      ...(isRecord(saved.ai) ? saved.ai : {}),
    },
    metadataProviders: {
      ...defaultAppSettings.metadataProviders,
      ...(isRecord(saved.metadataProviders) ? saved.metadataProviders : {}),
    },
    general: {
      ...defaultAppSettings.general,
      ...(isRecord(saved.general) ? saved.general : {}),
    },
  });
  return parsed.success ? parsed.data : defaultAppSettings;
}

export async function getPublicAppSettings(): Promise<PublicAppSettings> {
  return redactAppSettings(await getAppSettings());
}

export async function saveAppSettings(settings: AppSettings): Promise<AppSettings> {
  const parsed = appSettingsSchema.parse(settings);
  await prisma.appSetting.upsert({
    where: { key: SETTINGS_KEY },
    create: {
      key: SETTINGS_KEY,
      value: parsed as Prisma.InputJsonValue,
    },
    update: {
      value: parsed as Prisma.InputJsonValue,
    },
  });
  return parsed;
}

export async function updateDirectorySettings(input: unknown) {
  const current = await getAppSettings();
  const patch = directorySettingsPatchSchema.parse(input);
  const directories = directorySettingsSchema.parse({
    ...current.directories,
    ...patch,
  });

  return saveAppSettings({
    ...current,
    directories,
  });
}

export async function updateAria2Settings(input: unknown) {
  const current = await getAppSettings();
  const patch = aria2SettingsPatchSchema.parse(input);

  return saveAppSettings({
    ...current,
    aria2: aria2SettingsSchema.parse({
      ...current.aria2,
      ...patch,
    }),
  });
}

export async function updateAiSettings(input: unknown) {
  const current = await getAppSettings();
  const patch = aiSettingsPatchSchema.parse(input);

  return saveAppSettings({
    ...current,
    ai: aiSettingsSchema.parse({
      ...current.ai,
      ...patch,
      provider: "openrouter",
    }),
  });
}

export async function updateMetadataProviderSettings(input: unknown) {
  const current = await getAppSettings();
  const patch = metadataProviderSettingsPatchSchema.parse(input);

  return saveAppSettings({
    ...current,
    metadataProviders: metadataProviderSettingsSchema.parse({
      ...current.metadataProviders,
      ...patch,
    }),
  });
}

export async function updateGeneralSettings(input: unknown) {
  const current = await getAppSettings();
  const patch = generalSettingsPatchSchema.parse(input);

  return saveAppSettings({
    ...current,
    general: generalSettingsSchema.parse({
      ...current.general,
      ...patch,
    }),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
