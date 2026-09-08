import { ArrowDownLeft, ArrowUpRight, RefreshCw, Lock, Coins } from "lucide-react";
import { ActivityEntry, Role } from "@/lib/types";
import { StatusBadge, PrivacyBadge } from "@/components/ui/badge";
import { findPersona } from "@/lib/mock-data";
import { formatAmount, formatTimestamp, shortenAddress } from "@/lib/format";
import { canSeeConfidentialAmount } from "@/lib/permissions";
import { MINT } from "@/lib/mock-data";
import { useCopy } from "@/lib/i18n/use-copy";
import { SolscanIconLink } from "@/components/ui/solscan-link";

const TYPE_ICON: Record<ActivityEntry["type"], React.ElementType> = {
  mint: Coins,
  deposit: ArrowDownLeft,
  withdraw: ArrowUpRight,
  confidential_transfer: RefreshCw,
  apply_pending: RefreshCw,
};

export function ActivityRow({
  entry,
  role,
  ownerAccountId,
}: {
  entry: ActivityEntry;
  role: Role;
  ownerAccountId: string;
}) {
  const c = useCopy();
  const Icon = TYPE_ICON[entry.type];
  const from = findPersona(entry.fromAccountId);
  const to = findPersona(entry.toAccountId);
  const canSee = canSeeConfidentialAmount(entry, role, ownerAccountId);

  const typeLabel = {
    mint: c.activity.mintLabel,
    deposit: c.activity.depositLabel,
    withdraw: c.activity.withdrawLabel,
    confidential_transfer: c.activity.confidentialTransferLabel,
    apply_pending: c.activity.applyPendingLabel,
  }[entry.type];

  return (
    <div className="flex items-center gap-4 border-b border-border-subtle px-5 py-3 last:border-b-0">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-canvas text-ink-500">
        <Icon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink-900">
          {typeLabel}
          {entry.type === "confidential_transfer" && (
            <span className="font-normal text-ink-500">
              {" "}
              · {from?.name} → {to?.name}
            </span>
          )}
        </p>
        <p className="mt-0.5 truncate font-mono text-xs text-ink-400">
          {shortenAddress(entry.signature, 6)} · {formatTimestamp(entry.timestamp)}
        </p>
      </div>
      <div className="shrink-0 text-right">
        {entry.type === "confidential_transfer" ? (
          canSee && entry.confidential?.disclosedAmount != null ? (
            <p className="text-sm font-semibold text-ink-900">
              {formatAmount(entry.confidential.disclosedAmount)} {MINT.symbol}
            </p>
          ) : (
            <p className="flex items-center justify-end gap-1 text-sm font-medium text-ink-400">
              <Lock size={12} /> {c.common.encrypted}
            </p>
          )
        ) : (
          <p className="text-sm font-semibold text-ink-900">
            {formatAmount(entry.publicAmount ?? 0)} {MINT.symbol}
          </p>
        )}
      </div>
      <div className="hidden shrink-0 items-center gap-2.5 md:flex">
        <StatusBadge status={entry.status} />
        <PrivacyBadge variant={entry.privacy === "confidential" ? "encrypted" : "public"} />
      </div>
      <SolscanIconLink signature={entry.signature} />
    </div>
  );
}
