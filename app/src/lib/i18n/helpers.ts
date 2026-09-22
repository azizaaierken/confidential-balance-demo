import { EvidenceStep, FailureStage } from "@/lib/types";
import { Copy } from "./types";

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

// The send-transfer pipeline has two steps: building the transaction (which
// is where proof generation happens) and the single submit-and-confirm round
// trip. Both cluster-side failure stages therefore map to the second step.
const STAGE_TO_PIPELINE_STEP: Record<FailureStage, keyof Copy["sendTransfer"]> = {
  proof_generation: "stepProof",
  submission: "stepSubmitted",
  confirmation: "stepSubmitted",
};

// The pipeline-step label a given failure stage maps to, for sentences like
// "Failed at: <stage>".
export function stageLabel(c: Copy, stage: FailureStage): string {
  return c.sendTransfer[STAGE_TO_PIPELINE_STEP[stage]] as string;
}
