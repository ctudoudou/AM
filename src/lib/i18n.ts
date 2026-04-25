export const locales = ["en", "zh-Hans", "zh-Hant", "ja"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "zh-Hans";

export function isLocale(value: string): value is Locale {
  return locales.includes(value as Locale);
}

