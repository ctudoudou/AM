import { en } from "./en";
import { zhHans } from "./zh-Hans";
import type { Locale } from "@/lib/i18n";

const dictionaries = {
  en,
  "zh-Hans": zhHans,
  "zh-Hant": zhHans,
  ja: en,
};

export function getMessages(locale: Locale) {
  return dictionaries[locale];
}

