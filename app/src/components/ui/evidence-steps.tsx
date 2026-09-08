import { EvidenceStep } from "@/lib/types";
import { shortenAddress } from "@/lib/format";
import { evidenceStepLabel } from "@/lib/i18n/helpers";
import { useCopy } from "@/lib/i18n/use-copy";
import { SolscanIconLink } from "./solscan-link";

// Per-transaction breakdown for a multi-transaction operation. Solscan only
// reliably decodes the Token-2022 instruction in these — the separate ZK
// ElGamal Proof program instructions (context-state create/verify/close)
// typically show up there as "Unknown: Unknown" (confirmed by hand against a
// real transaction). This is the backend's own record of what each
// transaction was actually for, since only it knows.
export function EvidenceSteps({ steps }: { steps: EvidenceStep[] }) {
  const c = useCopy();
  if (steps.length <= 1) return null;

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
