"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { clsx } from "clsx";
import { useCopy } from "@/lib/i18n/use-copy";

// Copies the full, untruncated value — addresses everywhere in this app are
// shown shortened for readability, but a viewer independently verifying one
// (e.g. pasting it into a wallet or another explorer) needs the real thing.
export function CopyButton({ value, className }: { value: string; className?: string }) {
  const c = useCopy();
  const [copied, setCopied] = useState(false);

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — nothing to fall
      // back to; the button simply won't confirm a copy happened.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? c.common.copied : c.common.copyFullAddress}
      aria-label={copied ? c.common.copied : c.common.copyFullAddress}
      className={clsx(
        "inline-flex shrink-0 items-center justify-center rounded-md p-1 text-ink-400 hover:bg-canvas hover:text-ink-700",
        className
      )}
    >
      {copied ? <Check size={13} className="text-success-500" /> : <Copy size={13} />}
    </button>
  );
}
