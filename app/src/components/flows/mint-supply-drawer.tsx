"use client";

import { useState } from "react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { WarningNote, StatusBadge } from "@/components/ui/badge";
import { EvidenceDisclosure, EvidenceRow } from "@/components/ui/evidence-disclosure";
import { SolscanLink } from "@/components/ui/solscan-link";
import { useDemoStore } from "@/store/demo-store";
import { MINT, PERSONAS } from "@/lib/entities";
import { ActivityEntry } from "@/lib/types";
import { formatAmount, shortenAddress } from "@/lib/format";
import { useCopy } from "@/lib/i18n/use-copy";

export function MintSupplyDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const c = useCopy();
  const mintSupply = useDemoStore((s) => s.mintSupply);

  const [recipientId, setRecipientId] = useState(PERSONAS[0].id);
  const [amount, setAmount] = useState("");
  const [result, setResult] = useState<ActivityEntry | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    setRecipientId(PERSONAS[0].id);
    setAmount("");
    setResult(null);
    setError(null);
    onClose();
  }

  const numericAmount = parseFloat(amount) || 0;

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      setResult(await mintSupply(recipientId, numericAmount));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title={c.mint.drawerTitle}
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
            <Button disabled={numericAmount <= 0 || submitting} onClick={submit}>
              {submitting ? c.common.processing : c.mint.confirmButton}
            </Button>
          </div>
        )
      }
    >
      {!result ? (
        <div className="flex flex-col gap-5">
          <WarningNote>{c.mint.warning}</WarningNote>

          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
            {c.mint.recipientLabel}
            <select
              value={recipientId}
              onChange={(e) => setRecipientId(e.target.value)}
              className="rounded-lg border border-border-strong px-3 py-2.5 text-sm text-ink-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
            >
              {PERSONAS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {shortenAddress(p.address)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
            {MINT.symbol} {c.mint.amountLabel}
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              className="rounded-lg border border-border-strong px-3 py-2.5 text-sm text-ink-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
            />
          </label>
          {error && <p className="text-sm text-danger-600">{error}</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <StatusBadge status={result.status} />
          <div className="rounded-xl border border-success-100 bg-success-50 p-4 text-sm text-success-600">
            {c.mint.resultConfirmed}
          </div>
          <EvidenceDisclosure label={c.mint.evidenceTitle} defaultOpen>
            <EvidenceRow label={c.evidence.signatureLabel} value={result.signature} />
            <EvidenceRow
              label={c.depositWithdraw.publicAmountLabel}
              value={`${formatAmount(result.publicAmount ?? 0)} ${MINT.symbol}`}
            />
            <EvidenceRow label={c.evidence.programActivityLabel} value={result.programActivity.join(", ")} />
          </EvidenceDisclosure>
          <SolscanLink signature={result.signature} />
        </div>
      )}
    </Drawer>
  );
}
