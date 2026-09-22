"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clsx } from "clsx";
import {
  LayoutDashboard,
  ShieldCheck,
  ShieldQuestion,
  RotateCcw,
} from "lucide-react";
import { useDemoStore } from "@/store/demo-store";
import { PERSONAS, MINT } from "@/lib/entities";
import { Avatar } from "@/components/ui/avatar";
import { shortenAddress } from "@/lib/format";
import { useCopy } from "@/lib/i18n/use-copy";
import { LanguageSwitcher } from "./language-switcher";

export function Sidebar() {
  const c = useCopy();
  const pathname = usePathname();
  const router = useRouter();
  const network = useDemoStore((s) => s.network);
  const ownerAccountId = useDemoStore((s) => s.ownerAccountId);
  const setOwnerAccountId = useDemoStore((s) => s.setOwnerAccountId);
  const reset = useDemoStore((s) => s.reset);

  const OPERATIONS_NAV = [
    { href: "/", label: c.nav.dashboard, icon: LayoutDashboard },
    { href: "/audit", label: c.nav.audit, icon: ShieldCheck },
  ];

  const NETWORK_LABEL: Record<string, { text: string; dotClass: string; icon: React.ElementType }> = {
    connected: { text: c.common.devnetConnected, dotClass: "bg-success-500", icon: ShieldCheck },
    degraded: { text: c.common.devnetDegraded, dotClass: "bg-warning-500", icon: ShieldQuestion },
    disconnected: { text: c.common.devnetDisconnected, dotClass: "bg-danger-500", icon: ShieldQuestion },
  };
  const netCfg = NETWORK_LABEL[network];

  return (
    <aside className="flex h-screen w-16 shrink-0 flex-col border-r border-border-subtle bg-sidebar xl:w-64">
      <div className="flex items-center gap-2.5 px-3 py-5 xl:px-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
          CB
        </div>
        <div className="hidden xl:block">
          <p className="text-sm font-semibold text-ink-900">{c.nav.dashboard}</p>
          <p className="text-xs text-ink-500">{MINT.symbol}</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-2 xl:px-3">
        <p className="hidden px-2 pb-2 pt-3 text-xs font-semibold uppercase tracking-wide text-ink-400 xl:block">
          {c.nav.operations}
        </p>
        <NavLinkList items={OPERATIONS_NAV} pathname={pathname} />

        <p className="hidden px-2 pb-2 pt-5 text-xs font-semibold uppercase tracking-wide text-ink-400 xl:block">
          {c.nav.accounts}
        </p>
        <ul className="flex flex-col gap-0.5">
          {PERSONAS.map((persona) => {
            const active = ownerAccountId === persona.id && pathname.startsWith("/accounts");
            return (
              <li key={persona.id}>
                <button
                  onClick={() => {
                    setOwnerAccountId(persona.id);
                    router.push(`/accounts/${persona.id}`);
                  }}
                  title={persona.name}
                  className={clsx(
                    "flex w-full items-center justify-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors xl:justify-start",
                    active ? "bg-brand-50" : "hover:bg-ink-900/5"
                  )}
                >
                  <Avatar initials={persona.initials} seed={persona.id} size="sm" />
                  <span className="hidden min-w-0 flex-1 xl:block">
                    <span className="block truncate font-medium text-ink-900">
                      {persona.name}
                    </span>
                    <span className="block truncate font-mono text-xs text-ink-400">
                      {shortenAddress(persona.address)}
                    </span>
                  </span>
                  <span className="hidden shrink-0 rounded-full bg-ink-900/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-ink-500 xl:inline">
                    {persona.role === "sender" ? c.nav.sender : c.nav.receiver}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

      </nav>

      <div className="flex flex-col gap-2 border-t border-border-subtle px-2 py-3 xl:px-3">
        <div className="hidden xl:block">
          <LanguageSwitcher compact />
        </div>
        <button
          onClick={reset}
          title={c.nav.refreshFromDevnet}
          className="flex items-center justify-center gap-2 rounded-lg px-2 py-2 text-xs font-medium text-ink-500 hover:bg-ink-900/5 hover:text-ink-700 xl:justify-start"
        >
          <RotateCcw size={14} />
          <span className="hidden xl:inline">{c.nav.refreshFromDevnet}</span>
        </button>
        <div
          className="flex items-center justify-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-medium text-ink-700 xl:justify-start"
          title={netCfg.text}
        >
          <span className={clsx("h-2 w-2 shrink-0 rounded-full", netCfg.dotClass)} />
          <span className="hidden xl:inline">{netCfg.text}</span>
        </div>
      </div>
    </aside>
  );
}

function NavLinkList({
  items,
  pathname,
}: {
  items: { href: string; label: string; icon: React.ElementType }[];
  pathname: string;
}) {
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active = pathname === item.href;
        const Icon = item.icon;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              title={item.label}
              className={clsx(
                "flex items-center justify-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors xl:justify-start",
                active ? "bg-brand-50 text-brand-700" : "text-ink-700 hover:bg-ink-900/5"
              )}
            >
              <Icon size={16} strokeWidth={2.25} />
              <span className="hidden xl:inline">{item.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
