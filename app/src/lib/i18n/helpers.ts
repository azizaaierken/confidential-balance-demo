import { EvidenceStep, FailureStage, PolicyCheckKey } from "@/lib/types";
import { Copy } from "./types";

export function failureReasonText(c: Copy, stage: FailureStage): string {
  const map: Record<FailureStage, string> = {
    proposal_parsing: c.failure.proposalParsing,
    policy_checks: c.failure.policyChecks,
    proof_generation: c.failure.proofGeneration,
    wallet_approval: c.failure.walletApproval,
    submission: c.failure.submission,
    confirmation: c.failure.confirmation,
  };
  return map[stage];
}

export function policyCheckName(c: Copy, key: PolicyCheckKey): string {
  return c.policy[key].name;
}

export function evidenceStepLabel(c: Copy, step: EvidenceStep): string {
  const map: Record<EvidenceStep["label"], string> = {
    mint: c.evidence.mint,
    deposit: c.evidence.deposit,
    apply_pending: c.evidence.applyPending,
    verify_equality_proof: c.evidence.verifyEqualityProof,
    verify_validity_proof: c.evidence.verifyValidityProof,
    range_proof_stage: c.evidence.rangeProofStage,
    submit_transfer: c.evidence.submitTransfer,
    submit_withdraw: c.evidence.submitWithdraw,
    close_equality_proof: c.evidence.closeEqualityProof,
    close_range_proof: c.evidence.closeRangeProof,
    close_proof_record: c.evidence.closeProofRecord,
    submit_transfer_v1: c.evidence.submitTransferV1,
    submit_withdraw_v1: c.evidence.submitWithdrawV1,
    verify_range_proof: c.evidence.verifyRangeProof,
  };
  const base = map[step.label];
  return step.part != null ? `${base} (${c.evidence.part(step.part)})` : base;
}

const STAGE_TO_PIPELINE_STEP: Record<FailureStage, keyof Copy["sendTransfer"]> = {
  proposal_parsing: "stepProof",
  policy_checks: "stepProof",
  proof_generation: "stepProof",
  wallet_approval: "stepWallet",
  submission: "stepSubmitted",
  confirmation: "stepConfirmed",
};

// The pipeline-stage label (Preparing proof / Awaiting wallet approval / ...)
// a given failure stage maps to, for sentences like "Failed at: <stage>".
export function stageLabel(c: Copy, stage: FailureStage): string {
  return c.sendTransfer[STAGE_TO_PIPELINE_STEP[stage]] as string;
}
