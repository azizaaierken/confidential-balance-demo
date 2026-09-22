"use client";

import { clsx } from "clsx";
import { useDemoStore } from "@/store/demo-store";
import { LOCALE_LABELS, Locale } from "@/lib/i18n";
import { useCopy } from "@/lib/i18n/use-copy";

const LOCALES: Locale[] = ["en", "zh-Hans", "zh-Hant"];

export function LanguageSwitcher({ compact }: { compact?: boolean }) {
  const language = useDemoStore((s) => s.language);
  const setLanguage = useDemoStore((s) => s.setLanguage);
  const c = useCopy();

  return (
    <div
      role="tablist"
      aria-label={c.languageSwitcher.label}
      className={clsx(
        "inline-flex items-center rounded-lg border border-border-strong bg-white p-0.5",
        compact && "w-full justify-between"
      )}
    >
      {LOCALES.map((loc) => (
        <button
          key={loc}
          role="tab"
          aria-selected={language === loc}
          onClick={() => setLanguage(loc)}
          className={clsx(
            "rounded-md px-2 py-1 text-xs font-semibold transition-colors",
            compact && "flex-1",
            language === loc ? "bg-brand-600 text-white" : "text-ink-500 hover:bg-ink-900/5"
          )}
        >
          {LOCALE_LABELS[loc]}
        </button>
      ))}
    </div>
  );
}
