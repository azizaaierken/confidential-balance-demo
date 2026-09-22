"use client";

import { use, useEffect, useMemo, useState } from "react";
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
import { findPersona, MINT } from "@/lib/entities";
import { formatAmount, shortenAddress } from "@/lib/format";
import { canSeeAccountConfidentialBalance } from "@/lib/permissions";
import type { Role } from "@/lib/types";
import { ArrowDownCircle, ShieldCheck, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useCopy } from "@/lib/i18n/use-copy";

export default function AccountDetailPage({
  params,
}: PageProps<"/accounts/[id]">) {
  const c = useCopy();
  const { id } = use(params);
  const persona = findPersona(id);

  const ownerAccountId = useDemoStore((s) => s.ownerAccountId);
  const setOwnerAccountId = useDemoStore((s) => s.setOwnerAccountId);
  const balances = useDemoStore((s) => s.balances);
  const activity = useDemoStore((s) => s.activity);
  const applyPending = useDemoStore((s) => s.applyPending);
  const viewRoles = useDemoStore((s) => s.viewRoles);
  const loadingViewRoles = useDemoStore((s) => s.loadingViewRoles);

  const [sendOpen, setSendOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [applying, setApplying] = useState(false);

  // ownerAccountId is separate client state (defaults to the sender on every
  // reload) rather than derived from the URL — sync it here so landing on
  // (or refreshing) this exact account's page always treats you as viewing
  // it, the same way clicking it in the sidebar already does.
  useEffect(() => {
    if (id && ownerAccountId !== id) setOwnerAccountId(id);
  }, [id, ownerAccountId, setOwnerAccountId]);

  const isOwnerHere = id === "sender" || id === "receiver" ? viewRoles[id] : false;
  const loadingHere = id === "sender" || id === "receiver" ? loadingViewRoles[id] : false;
  const role: Role = isOwnerHere ? "owner" : "public";

  // A transfer's amount reaches this session whenever *either* party's view
  // is on — the sender legitimately knows what it sent, so the backend sends
  // it that amount for a sender→receiver transfer even while the receiver's
  // view is off. Correct as a rule, wrong to render here: this page is the
  // receiver's, showing masked balances in public view, so showing the
  // amount would read as a leak. Each account's page reveals only what *its*
  // own switch turns on; the sender's own page still shows the same transfer.
  const scopedActivity = useMemo(
    () =>
      activity
        .filter((a) => a.fromAccountId === id || a.toAccountId === id)
        .map((a) => (isOwnerHere ? a : { ...a, partyVisibleAmount: undefined })),
    [activity, id, isOwnerHere]
  );

  if (!persona) return notFound();

  const bal = balances[id];
  // The backend only ever sends a decrypted value when this account's owner
  // view is on (see rust-service/src/auth.rs); the check below is the
  // client-side mirror of that, never a substitute for it.
  const canSeeConfidential =
    canSeeAccountConfidentialBalance(id, role, id) && bal.confidentialAvailable.decrypted !== null;
  const hasPending = (bal.confidentialPending.decrypted ?? 0) > 0;

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
            {(id === "sender" || id === "receiver") && <RoleSwitcher accountId={id} />}
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
              value={formatAmount(bal.confidentialAvailable.decrypted ?? 0)}
              suffix={MINT.symbol}
              privacy="owner-only"
              locked={!canSeeConfidential}
              loading={isOwnerHere && loadingHere}
            />
            <BalanceRow
              label={c.dashboard.pendingConfidential}
              value={formatAmount(bal.confidentialPending.decrypted ?? 0)}
              suffix={MINT.symbol}
              privacy="owner-only"
              locked={!canSeeConfidential}
              loading={isOwnerHere && loadingHere}
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

        {/* Only when there is actually something to apply: an owner with a
            zero pending balance has nothing to do here. */}
        {canSeeConfidential && hasPending && (
          <div className="flex items-start gap-3 rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-700">
            <ArrowDownCircle size={18} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">{c.accountDetail.applyPendingNote}</p>
              <p className="mt-0.5 text-brand-700/90">{c.accountDetail.applyPendingDetail}</p>
            </div>
            <Button size="sm" className="ml-auto shrink-0" disabled={applying} onClick={handleApply}>
              {applying
                ? c.accountDetail.applying
                : c.accountDetail.applyButton(formatAmount(bal.confidentialPending.decrypted ?? 0), MINT.symbol)}
            </Button>
          </div>
        )}

        <Card>
          <CardHeader title={c.accountDetail.activityTitle} subtitle={c.accountDetail.activitySubtitle} />
          <ActivityList entries={scopedActivity} role={role} ownerAccountId={id} loading={isOwnerHere && loadingHere} />
        </Card>
      </main>

      <SendTransferDrawer open={sendOpen} onClose={() => setSendOpen(false)} fromAccountId={id!} />
      <DepositWithdrawDrawer open={depositOpen} onClose={() => setDepositOpen(false)} accountId={id!} direction="deposit" />
      <DepositWithdrawDrawer open={withdrawOpen} onClose={() => setWithdrawOpen(false)} accountId={id!} direction="withdraw" />
    </>
  );
}
