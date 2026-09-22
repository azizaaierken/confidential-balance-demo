"use client";

import { useState } from "react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { WarningNote, StatusBadge } from "@/components/ui/badge";
import { EvidenceDisclosure, EvidenceRow } from "@/components/ui/evidence-disclosure";
import { EvidenceSteps, expandEvidenceSteps } from "@/components/ui/evidence-steps";
import { SolscanLink } from "@/components/ui/solscan-link";
import { useDemoStore } from "@/store/demo-store";
import { MINT } from "@/lib/mock-data";
import { ActivityEntry } from "@/lib/types";
import { formatAmount } from "@/lib/format";
import { useCopy } from "@/lib/i18n/use-copy";

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function DepositWithdrawDrawer({
  open,
  onClose,
  accountId,
  direction,
}: {
  open: boolean;
  onClose: () => void;
  accountId: string;
  direction: "deposit" | "withdraw";
}) {
  const c = useCopy();
  const balances = useDemoStore((s) => s.balances);
  const deposit = useDemoStore((s) => s.deposit);
  const withdraw = useDemoStore((s) => s.withdraw);

  const [amount, setAmount] = useState("");
  const [result, setResult] = useState<ActivityEntry | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    setAmount("");
    setResult(null);
    setError(null);
    onClose();
  }

  const bal = balances[accountId];
  const source = direction === "deposit" ? bal?.publicBalance ?? 0 : bal?.confidentialAvailable.decrypted ?? 0;
  const numericAmount = parseFloat(amount) || 0;
  const insufficient = numericAmount > source;

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const entry =
        direction === "deposit"
          ? await deposit(accountId, numericAmount)
          : await withdraw(accountId, numericAmount);
      setResult(entry);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  const directionWord = direction === "deposit" ? c.depositWithdraw.depositWord : c.depositWithdraw.withdrawWord;
  const title = direction === "deposit" ? c.depositWithdraw.depositTitle : c.depositWithdraw.withdrawTitle;

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title={title}
      subtitle={`${MINT.symbol} · ${MINT.cluster}`}
      footer={
        result ? (
          <div className="flex justify-end">
            <Button onClick={handleClose}>{c.common.done}</Button>
          </div>
        ) : (
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={handleClose}>
              {c.common.cancel}
            </Button>
            <Button
              disabled={numericAmount <= 0 || insufficient || submitting}
              onClick={submit}
              className="capitalize"
            >
              {submitting ? c.common.processing : c.depositWithdraw.confirm(directionWord)}
            </Button>
          </div>
        )
      }
    >
      {!result ? (
        <div className="flex flex-col gap-5">
          <WarningNote>
            {direction === "deposit" ? c.depositWithdraw.depositWarning : c.depositWithdraw.withdrawWarning}
          </WarningNote>

          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
            {MINT.symbol} {c.depositWithdraw.amountLabel}
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              className="rounded-lg border border-border-strong px-3 py-2.5 text-sm text-ink-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
            />
            <span className="text-xs font-normal text-ink-500">
              {direction === "deposit" ? c.depositWithdraw.sourcePublic : c.depositWithdraw.sourceConfidential}:{" "}
              {formatAmount(source)} {MINT.symbol}
            </span>
          </label>
          {insufficient && <p className="text-sm text-danger-600">{c.depositWithdraw.insufficientNote}</p>}
          {error && <p className="text-sm text-danger-600">{error}</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <StatusBadge status={result.status} />
          <div className="rounded-xl border border-success-100 bg-success-50 p-4 text-sm text-success-600">
            {c.depositWithdraw.resultConfirmed(capitalize(directionWord))}
          </div>
          <EvidenceDisclosure label={c.depositWithdraw.evidenceTitle} defaultOpen>
            <EvidenceRow label="Signature" value={result.signature} />
            <EvidenceRow
              label={c.depositWithdraw.publicAmountLabel}
              value={`${formatAmount(result.publicAmount ?? 0)} ${MINT.symbol}`}
            />
            <EvidenceRow label="Program activity" value={result.programActivity.join(", ")} />
          </EvidenceDisclosure>

          <EvidenceSteps
            steps={direction === "withdraw" ? expandEvidenceSteps(result.steps, "withdraw") : result.steps}
          />

          <SolscanLink signature={result.signature} />
        </div>
      )}
    </Drawer>
  );
}
