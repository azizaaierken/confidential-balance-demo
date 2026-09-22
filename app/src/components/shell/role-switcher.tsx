"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { Eye, Loader2, Unlock } from "lucide-react";
import { useDemoStore } from "@/store/demo-store";
import { useCopy } from "@/lib/i18n/use-copy";
import type { ViewRole } from "@/lib/backend/client";

// Public observer view is the default for every account; the owner view is
// switched on per account here. This is the demo's stand-in for the owner
// connecting their wallet — a UI switch, not authentication.
export function RoleSwitcher({ accountId }: { accountId: "sender" | "receiver" }) {
  const c = useCopy();
  const isOwner = useDemoStore((s) => s.viewRoles[accountId]);
  const setViewRole = useDemoStore((s) => s.setViewRole);
  const [loading, setLoading] = useState(false);

  async function choose(owner: boolean) {
    if (isOwner === owner || loading) return;
    setLoading(true);
    try {
      await setViewRole(accountId as ViewRole, owner);
    } finally {
      setLoading(false);
    }
  }

  const options: { owner: boolean; label: string; icon: React.ElementType }[] = [
    { owner: false, label: c.roleSwitcher.publicView, icon: Eye },
    { owner: true, label: c.roleSwitcher.ownerView, icon: Unlock },
  ];

  return (
    <div
      role="radiogroup"
      aria-label={c.roleSwitcher.label}
      title={c.roleSwitcher.demoHint}
      className="inline-flex items-center rounded-lg border border-border-strong bg-white p-1"
    >
      {options.map(({ owner, label, icon: Icon }) => (
        <button
          key={String(owner)}
          role="radio"
          aria-checked={isOwner === owner}
          onClick={() => void choose(owner)}
          aria-busy={loading && isOwner === owner}
          className={clsx(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            isOwner === owner ? "bg-brand-600 text-white" : "text-ink-700 hover:bg-ink-900/5"
          )}
        >
          {loading && isOwner === owner ? (
            <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />
          ) : (
            <Icon size={14} />
          )}
          {label}
        </button>
      ))}
    </div>
  );
}
