import * as OpenCC from "opencc-js";
import { prisma } from "@/lib/db";
import type { AppSettings } from "@/lib/settings";

export type TitleLanguage = "zh-Hant" | "ja" | "zh-Hans" | "en" | "romaji";
export type TitleDisplayMode = "GLOBAL" | "ZH_HANT" | "ZH_HANS" | "JA" | "EN" | "CUSTOM";

export const defaultAnimeTitleLanguageOrder: TitleLanguage[] = [
  "zh-Hant",
  "ja",
  "zh-Hans",
  "en",
  "romaji",
];

const toSimplifiedChinese = OpenCC.Converter({ from: "tw", to: "cn" });
const toTraditionalChinese = OpenCC.Converter({ from: "cn", to: "tw" });
const releaseEditionPattern =
  /(?:^|[\s（(【\[])(?:放送版|オンエア版|先行放送版|先行版|無修正版|修正版|on[\s-]?air\s+version|broadcast\s+version|uncensored|censored)(?:$|[\s）)】\]])/gi;

type TitleAliasInput = {
  title: string;
  locale?: string | null;
};

type DisplayMediaTitle = {
  primaryTitle: string;
  originalTitle?: string | null;
  titleDisplayMode?: TitleDisplayMode | null;
  customDisplayTitle?: string | null;
  aliases?: TitleAliasInput[];
};

export function resolveMediaDisplayTitle(
  media: DisplayMediaTitle,
  settings?: Pick<AppSettings, "general"> | null,
) {
  const candidates = collectTitleCandidates(media);
  const customTitle = media.customDisplayTitle?.trim();
  const mode = media.titleDisplayMode ?? "GLOBAL";
  const order = resolveTitleOrder(mode, settings?.general.animeTitleLanguageOrder);
  const selected =
    mode === "CUSTOM" && customTitle
      ? { title: customTitle, locale: "custom" }
      : order
          .map((locale) => candidates.find((candidate) => candidate.locale === locale))
          .find(Boolean) ??
        candidates[0] ?? { title: media.primaryTitle, locale: "primary" };
  const secondaryTitles = uniqueTitles(
    candidates
      .map((candidate) => candidate.title)
      .filter((title) => title !== selected.title && title !== customTitle),
  ).slice(0, 3);

  return {
    displayTitle: selected.title,
    secondaryTitles,
    matchedLocale: selected.locale,
    mode,
  };
}

export function collectTitleCandidates(media: DisplayMediaTitle) {
  const candidates: Array<{ title: string; locale: string }> = [];
  const add = (title: string | null | undefined, locale?: string | null) => {
    const normalized = cleanTitle(title);
    if (!normalized) {
      return;
    }
    const resolvedLocale = locale || inferTitleLanguage(normalized);
    candidates.push({ title: normalized, locale: resolvedLocale });
    if (/[\u3400-\u9fff]/.test(normalized)) {
      candidates.push({ title: toTraditionalChinese(normalized), locale: "zh-Hant" });
      candidates.push({ title: toSimplifiedChinese(normalized), locale: "zh-Hans" });
    }
  };

  for (const alias of media.aliases ?? []) {
    add(alias.title, alias.locale);
  }
  for (const part of splitTitleParts(media.primaryTitle)) {
    add(part);
  }
  add(media.originalTitle, inferTitleLanguage(media.originalTitle ?? "", "ja"));

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.locale}:${candidate.title}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export async function upsertTitleAliases(mediaId: string, aliases: TitleAliasInput[]) {
  const cleanAliases = aliases
    .flatMap(expandChineseAlias)
    .map((alias) => ({
      title: cleanTitle(alias.title),
      locale: alias.locale?.trim() || null,
    }))
    .filter((alias): alias is { title: string; locale: string | null } => Boolean(alias.title));
  if (cleanAliases.length === 0) {
    return { created: 0 };
  }

  const existing = await prisma.titleAlias.findMany({
    where: { mediaId },
    select: { title: true, locale: true },
  });
  const existingKeys = new Set(existing.map((alias) => aliasKey(alias.title, alias.locale)));
  let created = 0;
  for (const alias of cleanAliases) {
    const key = aliasKey(alias.title, alias.locale);
    if (existingKeys.has(key)) {
      continue;
    }
    await prisma.titleAlias.create({
      data: {
        mediaId,
        title: alias.title,
        locale: alias.locale,
      },
    });
    existingKeys.add(key);
    created += 1;
  }
  return { created };
}

export function aliasesFromTitleTexts(values: Array<string | null | undefined>) {
  const aliases: TitleAliasInput[] = [];
  for (const value of values) {
    for (const part of splitTitleParts(value ?? "")) {
      aliases.push({ title: part, locale: inferTitleLanguage(part) });
    }
  }
  return aliases;
}

export function aliasesFromMetadataRaw(raw: unknown) {
  if (!raw || typeof raw !== "object") {
    return [];
  }
  const record = raw as Record<string, unknown>;
  const aliases: TitleAliasInput[] = [];
  const add = (title: unknown, locale?: string) => {
    if (typeof title === "string" && title.trim()) {
      aliases.push({ title, locale: locale ?? inferTitleLanguage(title) });
    }
  };

  add(record.title_english, "en");
  add(record.title_japanese, "ja");
  add(record.name_cn, "zh-Hans");
  add(record.name, "ja");
  add(record.original_title);
  add(record.original_name);
  add(record.canonicalTitle);

  const title = record.title;
  if (title && typeof title === "object") {
    const values = title as Record<string, unknown>;
    add(values.english, "en");
    add(values.romaji, "romaji");
    add(values.native, inferTitleLanguage(String(values.native ?? ""), "ja"));
  } else {
    add(title);
  }

  const attrs = record.attributes;
  if (attrs && typeof attrs === "object") {
    aliases.push(...aliasesFromMetadataRaw(attrs));
  }

  const titles = record.titles;
  if (Array.isArray(titles)) {
    for (const item of titles) {
      if (typeof item === "string") {
        add(item);
      } else if (item && typeof item === "object") {
        add((item as Record<string, unknown>).title);
      }
    }
  } else if (titles && typeof titles === "object") {
    for (const [key, value] of Object.entries(titles)) {
      add(value, localeFromProviderKey(key));
    }
  }

  const synonyms = record.title_synonyms;
  if (Array.isArray(synonyms)) {
    for (const synonym of synonyms) {
      add(synonym);
    }
  }

  return aliases;
}

function resolveTitleOrder(mode: TitleDisplayMode, globalOrder?: TitleLanguage[]) {
  const fallback = uniqueLanguages(globalOrder ?? defaultAnimeTitleLanguageOrder);
  const modeLanguage: Partial<Record<TitleDisplayMode, TitleLanguage>> = {
    ZH_HANT: "zh-Hant",
    ZH_HANS: "zh-Hans",
    JA: "ja",
    EN: "en",
  };

  return modeLanguage[mode] ? uniqueLanguages([modeLanguage[mode], ...fallback]) : fallback;
}

function inferTitleLanguage(value: string, fallback: string = "en") {
  if (/[\u3040-\u30ff]/.test(value)) {
    return "ja";
  }
  if (/[\u3400-\u9fff]/.test(value)) {
    return toTraditionalChinese(value) === value ? "zh-Hant" : "zh-Hans";
  }
  if (/^[\x00-\x7f]+$/.test(value)) {
    return /(?:\bkun\b|\bsama\b|\bchan\b|\bsenpai\b|shi\b|ou\b|mairimashita)/i.test(value)
      ? "romaji"
      : "en";
  }
  return fallback;
}

function localeFromProviderKey(key: string) {
  if (key === "ja_jp") {
    return "ja";
  }
  if (key === "en_jp") {
    return "romaji";
  }
  if (key.startsWith("zh")) {
    return key.toLowerCase().includes("hant") ? "zh-Hant" : "zh-Hans";
  }
  if (key.startsWith("en")) {
    return "en";
  }
  return undefined;
}

function expandChineseAlias(alias: TitleAliasInput) {
  const title = cleanTitle(alias.title);
  if (!title || !/[\u3400-\u9fff]/.test(title)) {
    return [alias];
  }
  return [
    alias,
    { title: toTraditionalChinese(title), locale: "zh-Hant" },
    { title: toSimplifiedChinese(title), locale: "zh-Hans" },
  ];
}

function splitTitleParts(value: string) {
  return value
    .split(/\s+\/\s+|｜|\|/)
    .map(cleanTitle)
    .filter((part): part is string => Boolean(part));
}

function cleanTitle(value: string | null | undefined) {
  return (
    value
      ?.replace(releaseEditionPattern, " ")
      .replace(/\s+/g, " ")
      .trim() || ""
  );
}

function uniqueTitles(values: string[]) {
  return [...new Set(values.map(cleanTitle).filter(Boolean))];
}

function uniqueLanguages(values: TitleLanguage[]) {
  const allowed = new Set(defaultAnimeTitleLanguageOrder);
  const languages = values.filter((value) => allowed.has(value));
  return [...new Set([...languages, ...defaultAnimeTitleLanguageOrder])];
}

function aliasKey(title: string, locale: string | null | undefined) {
  return `${locale ?? ""}:${title.toLowerCase()}`;
}
