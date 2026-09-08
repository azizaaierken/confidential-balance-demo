"use client";

import { use, useMemo, useState } from "react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { RoleSwitcher } from "@/components/shell/role-switcher";
import { Card, CardHeader } from "@/components/ui/card";
import { BalanceRow } from "@/components/ui/balance-row";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { CopyButton } from "@/components/ui/copy-button";
import { ActivityList } from "@/components/activity/activity-list";
import { SendTransferDrawer } from "@/components/flows/send-transfer-drawer";
import { DepositWithdrawDrawer } from "@/components/flows/deposit-withdraw-drawer";
import { useDemoStore } from "@/store/demo-store";
import { findPersona, MINT } from "@/lib/mock-data";
import { formatAmount, shortenAddress } from "@/lib/format";
import { canSeeAccountConfidentialBalance } from "@/lib/permissions";
import { ArrowDownCircle, ShieldCheck, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useCopy } from "@/lib/i18n/use-copy";

export default function AccountDetailPage({
  params,
}: PageProps<"/accounts/[id]">) {
  const c = useCopy();
  const { id } = use(params);
  const persona = findPersona(id);

  const role = useDemoStore((s) => s.role);
  const ownerAccountId = useDemoStore((s) => s.ownerAccountId);
  const balances = useDemoStore((s) => s.balances);
  const activity = useDemoStore((s) => s.activity);
  const applyPending = useDemoStore((s) => s.applyPending);

  const [sendOpen, setSendOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [applying, setApplying] = useState(false);

  const scopedActivity = useMemo(
    () => activity.filter((a) => a.fromAccountId === id || a.toAccountId === id),
    [activity, id]
  );

  if (!persona) return notFound();

  const bal = balances[id];
  const canSeeConfidential = canSeeAccountConfidentialBalance(id, role, ownerAccountId);
  const isOwnerHere = role === "owner" && ownerAccountId === id;
  const hasPending = bal.confidentialPending.decrypted > 0;

  async function handleApply() {
    setApplying(true);
    try {
      await applyPending(id!);
    } finally {
      setApplying(false);
    }
  }

  return (
    <>
      <PageHeader
        title={persona.name}
        subtitle={c.accountDetail.subtitle(shortenAddress(persona.tokenAccount))}
        actions={
          <div className="flex items-center gap-3">
            <RoleSwitcher />
            <Link
              href="/audit"
              className="flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-brand-700"
            >
              <ShieldCheck size={14} />
              {c.dashboard.viewAsAuditor}
              <ArrowRight size={14} />
            </Link>
          </div>
        }
      />

      <main className="flex flex-col gap-5 px-6 py-6">
        <div className="flex items-center gap-3">
          <Avatar initials={persona.initials} seed={persona.id} size="lg" />
          <div>
            <p className="text-sm font-semibold text-ink-900">{persona.name}</p>
            <p className="flex items-center gap-1 font-mono text-xs text-ink-400">
              {shortenAddress(persona.address, 6)}
              <CopyButton value={persona.address} />
            </p>
          </div>
          <span className="ml-auto rounded-full bg-canvas px-3 py-1 text-xs font-semibold uppercase text-ink-500">
            {persona.role === "sender" ? c.nav.sender : c.nav.receiver}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <Card className="lg:col-span-7">
            <BalanceRow
              label={c.dashboard.publicBalance}
              value={formatAmount(bal.publicBalance)}
              suffix={MINT.symbol}
              privacy="public"
            />
            <BalanceRow
              label={c.dashboard.availableConfidential}
              value={formatAmount(bal.confidentialAvailable.decrypted)}
              suffix={MINT.symbol}
              privacy="owner-only"
              locked={!canSeeConfidential}
            />
            <BalanceRow
              label={c.dashboard.pendingConfidential}
              value={formatAmount(bal.confidentialPending.decrypted)}
              suffix={MINT.symbol}
              privacy="owner-only"
              locked={!canSeeConfidential}
              accent="warning"
            />
          </Card>

          <div className="lg:col-span-5">
            {isOwnerHere ? (
              <div className="flex h-full flex-col gap-3">
                <Button onClick={() => setSendOpen(true)}>{c.dashboard.sendTransfer}</Button>
                <Button variant="secondary" className="capitalize" onClick={() => setDepositOpen(true)}>
                  {c.depositWithdraw.depositWord}
                </Button>
                <Button variant="secondary" className="capitalize" onClick={() => setWithdrawOpen(true)}>
                  {c.depositWithdraw.withdrawWord}
                </Button>
              </div>
            ) : (
              <div className="flex h-full flex-col justify-center rounded-2xl border border-border-subtle bg-surface p-5 text-sm text-ink-500">
                {c.accountDetail.switchToOwnerNote}
              </div>
            )}
          </div>
        </div>

        {canSeeConfidential && (
          <div className="flex items-start gap-3 rounded-xl border border-warning-100 bg-warning-50 px-4 py-3 text-sm text-warning-600">
            <ArrowDownCircle size={18} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">{c.accountDetail.applyPendingNote}</p>
              <p className="mt-0.5 text-warning-600/90">{c.accountDetail.applyPendingDetail}</p>
            </div>
            {hasPending && (
              <Button size="sm" className="ml-auto shrink-0" disabled={applying} onClick={handleApply}>
                {applying
                  ? c.accountDetail.applying
                  : c.accountDetail.applyButton(formatAmount(bal.confidentialPending.decrypted), MINT.symbol)}
              </Button>
            )}
          </div>
        )}

        <Card>
          <CardHeader title={c.accountDetail.activityTitle} subtitle={c.accountDetail.activitySubtitle} />
          <ActivityList entries={scopedActivity} role={role} ownerAccountId={ownerAccountId} />
        </Card>
      </main>

      <SendTransferDrawer open={sendOpen} onClose={() => setSendOpen(false)} fromAccountId={id!} />
      <DepositWithdrawDrawer open={depositOpen} onClose={() => setDepositOpen(false)} accountId={id!} direction="deposit" />
      <DepositWithdrawDrawer open={withdrawOpen} onClose={() => setWithdrawOpen(false)} accountId={id!} direction="withdraw" />
    </>
  );
}
