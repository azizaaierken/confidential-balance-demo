"use client";

import { Wallet } from "lucide-react";
import { useDemoStore } from "@/store/demo-store";
import { shortenAddress } from "@/lib/format";
import { InfoTooltip } from "@/components/ui/info-tooltip";

export function PageHeader({
  title,
  subtitle,
  actions,
  showWallet = true,
  infoTooltip,
}: {
  title: string;
  subtitle: string;
  actions?: React.ReactNode;
  // The connected-wallet chip only means something on pages where it's
  // actually the signer for something (account pages, agent payments). The
  // Main Console never grants owner authority, so it hides this chip rather
  // than implying a signed-in identity that has no effect there.
  showWallet?: boolean;
  // Optional longer explanation, shown on hover/focus instead of permanently
  // occupying page layout.
  infoTooltip?: string;
}) {
  const wallet = useDemoStore((s) => s.connectedWalletAddress);

  return (
    <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-4 border-b border-border-subtle bg-canvas/90 px-6 py-5 backdrop-blur">
      <div>
        <h1 className="text-xl font-semibold text-ink-900">{title}</h1>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-500">
          {subtitle}
          {infoTooltip && <InfoTooltip text={infoTooltip} />}
        </p>
      </div>
      <div className="flex items-center gap-3">
        {showWallet && (
          <span className="hidden items-center gap-2 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-xs font-medium text-ink-700 sm:flex">
            <Wallet size={14} className="text-ink-400" />
            {shortenAddress(wallet)}
          </span>
        )}
        {actions}
      </div>
    </header>
  );
}
