import type { Locale } from "./i18n/types";

// The BCP 47 tag `Intl` should format numbers and dates with, per UI locale.
const INTL_LOCALE: Record<Locale, string> = {
  en: "en-US",
  "zh-Hans": "zh-CN",
  "zh-Hant": "zh-TW",
};

// Module-level mirror of the store's `language`, for code that formats
// values outside a React render (or that can't depend on the store without
// creating an import cycle). The store updates it in `setLanguage`; readers
// re-render anyway because they subscribe to the store's `language`.
let active: Locale = "en";

export function setActiveLocale(locale: Locale) {
  active = locale;
}

export function activeLocale(): Locale {
  return active;
}

export function intlLocale(locale: Locale = active): string {
  return INTL_LOCALE[locale];
}
