"use client";

import { clsx } from "clsx";
import { Eye, Unlock } from "lucide-react";
import { useDemoStore } from "@/store/demo-store";
import { useCopy } from "@/lib/i18n/use-copy";

export function RoleSwitcher() {
  const c = useCopy();
  const role = useDemoStore((s) => s.role);
  const setRole = useDemoStore((s) => s.setRole);

  return (
    <div
      role="tablist"
      aria-label={c.roleSwitcher.label}
      className="inline-flex items-center rounded-lg border border-border-strong bg-white p-1"
    >
      <button
        role="tab"
        aria-selected={role === "owner"}
        onClick={() => setRole("owner")}
        className={clsx(
          "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
          role === "owner" ? "bg-brand-600 text-white" : "text-ink-700 hover:bg-ink-900/5"
        )}
      >
        <Unlock size={14} />
        {c.roleSwitcher.ownerView}
      </button>
      <button
        role="tab"
        aria-selected={role === "public"}
        onClick={() => setRole("public")}
        className={clsx(
          "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
          role === "public" ? "bg-brand-600 text-white" : "text-ink-700 hover:bg-ink-900/5"
        )}
      >
        <Eye size={14} />
        {c.roleSwitcher.publicView}
      </button>
    </div>
  );
}
