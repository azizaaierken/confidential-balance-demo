"use client";

import { useState } from "react";
import { ChevronDown, FlaskConical } from "lucide-react";
import { clsx } from "clsx";

export function EvidenceDisclosure({
  label = "Technical details",
  children,
  defaultOpen = false,
}: {
  label?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-border-subtle bg-canvas/60">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium text-ink-700"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <FlaskConical size={14} className="text-ink-400" />
          {label}
        </span>
        <ChevronDown
          size={16}
          className={clsx("text-ink-400 transition-transform motion-reduce:transition-none", open && "rotate-180")}
        />
      </button>
      {open && <div className="border-t border-border-subtle px-4 py-3">{children}</div>}
    </div>
  );
}

export function EvidenceRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className="shrink-0 text-ink-500">{label}</span>
      <span className="text-right font-mono text-xs text-ink-900 break-all">{value}</span>
    </div>
  );
}
