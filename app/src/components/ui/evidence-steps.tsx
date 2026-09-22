import { EvidenceStep } from "@/lib/types";
import { shortenAddress } from "@/lib/format";
import { evidenceStepLabel } from "@/lib/i18n/helpers";
import { useCopy } from "@/lib/i18n/use-copy";
import { SolscanIconLink } from "./solscan-link";

// The backend now records exactly one real signature for a V1
// transfer/withdraw — but that one transaction still bundles several
// instructions (proof verifications + the transfer/withdraw itself), which
// is exactly the part Solscan can't label. Expand that single step into one
// row per instruction, in on-chain order, all sharing the same signature, so
// the breakdown stays visible instead of collapsing to a single opaque row.
// A no-op for anything else (older multi-transaction entries, or a single
// step that isn't one of these two labels).
export function expandEvidenceSteps(
  steps: EvidenceStep[],
  kind: "transfer" | "withdraw"
): EvidenceStep[] {
  if (steps.length !== 1) return steps;
  const [only] = steps;
  const sig = only.signature;
  if (kind === "transfer" && only.label === "submit_transfer_v1") {
    return [
      { label: "verify_equality_proof", signature: sig },
      { label: "verify_validity_proof", signature: sig },
      { label: "verify_range_proof", signature: sig },
      { label: "submit_transfer_v1", signature: sig },
    ];
  }
  if (kind === "withdraw" && only.label === "submit_withdraw_v1") {
    return [
      { label: "submit_withdraw_v1", signature: sig },
      { label: "verify_equality_proof", signature: sig },
      { label: "verify_range_proof", signature: sig },
    ];
  }
  return steps;
}

// Breakdown of what actually happened on-chain for this operation — a
// row per real transaction for older, multi-transaction activity entries, or
// (see send-transfer-drawer.tsx / deposit-withdraw-drawer.tsx) a row per
// instruction, all sharing the one V1 transaction's signature, for a
// transfer/withdraw recorded after the V1 rewrite. Solscan only reliably
// decodes the Token-2022 instruction in these — the separate ZK ElGamal
// Proof program instructions typically show up there as "Unknown: Unknown"
// (confirmed by hand against a real transaction) — so this stays the one
// place to see what a transaction actually did without leaving the app.
export function EvidenceSteps({ steps }: { steps: EvidenceStep[] }) {
  const c = useCopy();
  if (steps.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">
        {c.evidence.stepsTitle}
      </p>
      <div className="rounded-lg border border-border-subtle">
        {steps.map((step, i) => (
          <div
            key={`${step.label}-${i}`}
            className="flex items-center justify-between gap-3 border-b border-border-subtle px-3 py-2 text-sm last:border-b-0"
          >
            <span className="min-w-0 flex-1 truncate text-ink-700">{evidenceStepLabel(c, step)}</span>
            <span className="shrink-0 font-mono text-xs text-ink-400">
              {shortenAddress(step.signature, 6)}
            </span>
            <SolscanIconLink signature={step.signature} />
          </div>
        ))}
      </div>
      <p className="text-xs text-ink-400">{c.evidence.solscanGap}</p>
    </div>
  );
}
