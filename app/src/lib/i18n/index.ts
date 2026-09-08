import { Locale } from "./types";
import { en } from "./en";
import { zhHans } from "./zh-hans";
import { zhHant } from "./zh-hant";

export type { Locale, Copy } from "./types";

export const DICTIONARIES = {
  en,
  "zh-Hans": zhHans,
  "zh-Hant": zhHant,
} as const;

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "EN",
  "zh-Hans": "简",
  "zh-Hant": "繁",
};

export function getCopy(locale: Locale) {
  return DICTIONARIES[locale];
}
