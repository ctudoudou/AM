import { en } from "./en";
import { zhHans } from "./zh-Hans";
import { zhHant } from "./zh-Hant";
import type { Locale } from "@/lib/i18n";

const dictionaries = {
  en,
  "zh-Hans": zhHans,
  "zh-Hant": zhHant,
};

export function getMessages(locale: Locale) {
  return dictionaries[locale];
}
