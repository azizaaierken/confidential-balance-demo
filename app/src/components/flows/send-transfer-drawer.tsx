"use client";

import { useEffect, useState } from "react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { ProgressTracker, TrackerStep } from "@/components/ui/progress-tracker";
import { WarningNote, StatusBadge } from "@/components/ui/badge";
import * as backend from "@/lib/backend/client";
import { EvidenceDisclosure, EvidenceRow } from "@/components/ui/evidence-disclosure";
import { useDemoStore } from "@/store/demo-store";
import { MINT, PERSONAS } from "@/lib/entities";
import { ActivityEntry, FailureStage } from "@/lib/types";
import { formatAmount, shortenAddress } from "@/lib/format";
import { ShieldAlert } from "lucide-react";
import { useCopy } from "@/lib/i18n/use-copy";
import { stageLabel } from "@/lib/i18n/helpers";
import { classifyFailure } from "@/lib/failure";
import { SolscanLink } from "@/components/ui/solscan-link";
import { EvidenceSteps, expandEvidenceSteps } from "@/components/ui/evidence-steps";

type FlowStep = "review" | "signing" | "progress" | "result";

type SimulationState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; result: backend.TransferSimulation }
  | { status: "unavailable"; reason: string };

const LAMPORTS_PER_SOL = 1_000_000_000;

// A confidential transfer is one V1 transaction: the backend generates the
// three proofs, builds the transaction, then submits and waits for
// confirmation in a single call. The tracker shows exactly those two phases
// and nothing the UI can't actually observe — there is no wallet step (the
// backend signs with the persona's demo keypair) and no separate "submitted"
// moment distinct from confirmation.
const STAGE_TO_STEP_INDEX: Record<FailureStage, number> = {
  proof_generation: 0,
  submission: 1,
  confirmation: 1,
};

export function SendTransferDrawer({
  open,
  onClose,
  fromAccountId,
}: {
  open: boolean;
  onClose: () => void;
  fromAccountId: string;
}) {
  const c = useCopy();
  const balances = useDemoStore((s) => s.balances);
  const confidentialTransfer = useDemoStore((s) => s.confidentialTransfer);
  const connectedWallet = useDemoStore((s) => s.connectedWalletAddress);

  const STEPS: TrackerStep[] = [
    { key: "build", label: c.sendTransfer.stepProof },
    { key: "confirm", label: c.sendTransfer.stepSubmitted },
  ];

  const recipients = PERSONAS.filter((p) => p.id !== fromAccountId);
  const [toId, setToId] = useState(recipients[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<FlowStep>("review");
  const [result, setResult] = useState<ActivityEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failureStage, setFailureStage] = useState<FailureStage | null>(null);

  const fromPersona = PERSONAS.find((p) => p.id === fromAccountId);
  const available = balances[fromAccountId]?.confidentialAvailable.decrypted ?? 0;

  const numericAmount = parseFloat(amount) || 0;
  const preflightInsufficient = numericAmount > available;

  // Building the transaction means generating all three ZK proofs, so this is
  // a real ~2-3s round trip, not something to fire on every keystroke — hence
  // the debounce. The over-balance case is settled locally first (against the
  // genuine decrypted balance) and never reaches the node: proof generation
  // would refuse to build a proof that underflows before the cluster is even
  // asked, which is a worse error to show than simply saying so up front.
  //
  // Only the *outcome* of a simulation lives in state, tagged with the inputs
  // it was run for. "idle" and "running" are derived during render: not
  // simulating means idle, and simulating with no outcome for the current
  // inputs means running. That keeps the effect free of synchronous setState
  // calls (which React's hooks lint flags as a cascading-render hazard) and
  // means a stale outcome can never be shown against fresh inputs.
  const shouldSimulate =
    open && step === "review" && numericAmount > 0 && !preflightInsufficient && Boolean(toId);
  const simulationKey = `${fromAccountId}|${toId}|${numericAmount}`;
  const [simulationOutcome, setSimulationOutcome] = useState<{
    key: string;
    state: Extract<SimulationState, { status: "done" | "unavailable" }>;
  } | null>(null);
  const simulation: SimulationState = !shouldSimulate
    ? { status: "idle" }
    : simulationOutcome?.key === simulationKey
      ? simulationOutcome.state
      : { status: "running" };

  useEffect(() => {
    if (!shouldSimulate) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await backend.simulateTransfer(
          fromAccountId,
          toId,
          numericAmount,
          useDemoStore.getState().viewRoles
        );
        if (!cancelled) {
          setSimulationOutcome({ key: simulationKey, state: { status: "done", result } });
        }
      } catch (e) {
        // Couldn't build or couldn't reach the cluster — report it as such
        // rather than as a verdict on the transfer itself.
        if (!cancelled) {
          setSimulationOutcome({
            key: simulationKey,
            state: {
              status: "unavailable",
              reason: e instanceof Error ? e.message : String(e),
            },
          });
        }
      }
    }, 700);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [shouldSimulate, simulationKey, fromAccountId, toId, numericAmount]);

  function handleClose() {
    setStep("review");
    setAmount("");
    setResult(null);
    setError(null);
    setFailureStage(null);
    setToId(recipients[0]?.id ?? "");
    onClose();
  }

  function startSigning() {
    setStep("signing");
  }

  async function submitTransfer() {
    setStep("progress");
    try {
      const entry = await confidentialTransfer(fromAccountId, toId, numericAmount);
      setResult(entry);
      setStep("result");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setFailureStage(classifyFailure(message));
      setError(message);
      setStep("result");
    }
  }

  // While the request is in flight the UI genuinely cannot tell which phase
  // the backend is in, so the first step stays active until the whole call
  // returns. On success both steps are done; on failure the classified stage
  // decides which one is marked failed.
  const trackerIndex =
    step === "progress"
      ? 0
      : result
        ? STEPS.length
        : failureStage
          ? STAGE_TO_STEP_INDEX[failureStage]
          : 0;

  const footer =
    step === "review" ? (
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={handleClose}>
          {c.common.cancel}
        </Button>
        <Button
          disabled={numericAmount <= 0 || preflightInsufficient || !toId}
          onClick={startSigning}
        >
          {c.sendTransfer.reviewAndSign}
        </Button>
      </div>
    ) : step === "signing" ? (
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={() => setStep("review")}>
          {c.common.back}
        </Button>
        <Button onClick={submitTransfer}>{c.sendTransfer.approveInWallet}</Button>
      </div>
    ) : step === "result" ? (
      <div className="flex justify-end">
        <Button onClick={handleClose}>{c.common.done}</Button>
      </div>
    ) : undefined;

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title={c.sendTransfer.title}
      subtitle={`${MINT.symbol} · ${MINT.cluster}`}
      footer={footer}
    >
      {step === "review" && (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 rounded-xl border border-border-subtle p-4 text-sm">
            <div>
              <p className="text-ink-500">{c.sendTransfer.network}</p>
              <p className="font-medium text-ink-900">{MINT.cluster}</p>
            </div>
            <div>
              <p className="text-ink-500">{c.sendTransfer.assetMint}</p>
              <p className="font-medium text-ink-900">
                {MINT.symbol} · {shortenAddress(MINT.address)}
              </p>
            </div>
            <div>
              <p className="text-ink-500">{c.sendTransfer.sender}</p>
              <p className="font-medium text-ink-900">{fromPersona?.name}</p>
            </div>
            <div>
              <p className="text-ink-500">{c.sendTransfer.feePayer}</p>
              <p className="font-mono text-ink-900">{shortenAddress(MINT.feePayer)}</p>
              <p className="text-xs text-ink-500">{c.sendTransfer.feePayerNote}</p>
            </div>
          </div>

          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
            {c.sendTransfer.receiver}
            <select
              value={toId}
              onChange={(e) => setToId(e.target.value)}
              className="rounded-lg border border-border-strong px-3 py-2.5 text-sm text-ink-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
            >
              {recipients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {shortenAddress(p.address)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
            {MINT.symbol} {c.sendTransfer.amountLabel}
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              className="rounded-lg border border-border-strong px-3 py-2.5 text-sm text-ink-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
            />
            <span className="text-xs font-normal text-ink-500">
              {c.sendTransfer.availableBalance(formatAmount(available), MINT.symbol)}
            </span>
          </label>

          <div className="rounded-xl border border-border-subtle bg-canvas/60 p-4 text-sm">
            <p className="mb-1 font-medium text-ink-700">{c.sendTransfer.simulationTitle}</p>
            {numericAmount <= 0 ? (
              <p className="text-ink-500">{c.sendTransfer.simulationEmpty}</p>
            ) : preflightInsufficient ? (
              <p className="text-danger-600">{c.sendTransfer.simulationInsufficient}</p>
            ) : simulation.status === "running" || simulation.status === "idle" ? (
              <p className="text-ink-500">{c.sendTransfer.simulationRunning}</p>
            ) : simulation.status === "unavailable" ? (
              <p className="text-warning-600">
                {c.sendTransfer.simulationUnavailable(simulation.reason)}
              </p>
            ) : simulation.result.success ? (
              <p className="text-success-600">
                {c.sendTransfer.simulationSuccess(
                  simulation.result.feeLamports != null
                    ? (simulation.result.feeLamports / LAMPORTS_PER_SOL).toFixed(6)
                    : "—",
                  simulation.result.unitsConsumed?.toLocaleString() ?? "—"
                )}
              </p>
            ) : (
              <p className="text-danger-600">
                {c.sendTransfer.simulationFailed(simulation.result.error ?? "unknown error")}
              </p>
            )}
          </div>

          <WarningNote>{c.sendTransfer.addressWarning}</WarningNote>
        </div>
      )}

      {step === "signing" && (
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="rounded-full bg-ink-900/5 p-4">
            <ShieldAlert size={28} className="text-ink-500" />
          </div>
          <div>
            <p className="text-base font-semibold text-ink-900">{c.sendTransfer.waitingWalletTitle}</p>
            <p className="mt-1 text-sm text-ink-500">{c.sendTransfer.waitingWalletBody}</p>
          </div>
          <p className="font-mono text-xs text-ink-400">{shortenAddress(connectedWallet)}</p>
        </div>
      )}

      {step === "progress" && (
        <div className="py-4">
          <ProgressTracker steps={STEPS} currentIndex={trackerIndex} failedAtIndex={null} />
        </div>
      )}

      {step === "result" && error && (
        <div className="flex flex-col gap-5">
          <ProgressTracker steps={STEPS} currentIndex={trackerIndex} failedAtIndex={trackerIndex} />
          <div className="rounded-xl border border-danger-100 bg-danger-50 p-4 text-sm text-danger-600">
            <p className="font-medium">
              {c.sendTransfer.resultFailedAt(failureStage ? stageLabel(c, failureStage) : "")}
            </p>
            <p className="mt-1">{error}</p>
          </div>
        </div>
      )}

      {step === "result" && result && (
        <div className="flex flex-col gap-5">
          <StatusBadge status={result.status} />
          <div className="rounded-xl border border-success-100 bg-success-50 p-4 text-sm text-success-600">
            {c.sendTransfer.resultConfirmed}
          </div>

          <EvidenceDisclosure label={c.sendTransfer.evidenceTitle} defaultOpen>
            <EvidenceRow label={c.evidence.signatureLabel} value={result.signature} />
            <EvidenceRow label={c.evidence.programActivityLabel} value={result.programActivity.join(", ")} />
            {result.confidential && (
              <EvidenceRow label={c.evidence.ciphertextLabel} value={result.confidential.ciphertext} />
            )}
            {result.proofAccountRef && (
              <EvidenceRow label={c.evidence.proofAccountLabel} value={result.proofAccountRef} />
            )}
          </EvidenceDisclosure>

          <EvidenceSteps steps={expandEvidenceSteps(result.steps, "transfer")} />

          <SolscanLink signature={result.signature} />
        </div>
      )}
    </Drawer>
  );
}
