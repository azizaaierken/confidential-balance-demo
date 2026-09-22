// Domain model for the Confidential Balance demo frontend.
//
// Every value here is hydrated from the Rust devnet backend (see
// lib/backend/client.ts) — nothing is simulated client-side. The shapes mirror
// the Token-2022 Confidential Transfer data model (ciphertext fields, pending
// vs available, per-transfer auditor ciphertext, key generations) so the UI
// reads like the protocol it demonstrates.

export type Role = "owner" | "public" | "auditor";

export type NetworkStatus = "connected" | "degraded" | "disconnected";

export type PrivacyClassification = "public" | "confidential";

export interface Persona {
  id: string;
  name: string;
  initials: string;
  address: string; // devnet base58 address, filled in from the backend
  tokenAccount: string;
  role: "sender" | "receiver";
}

export interface Mint {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  programId: string; // Token-2022 program id
  zkProofProgramId: string;
  confidentialTransferAuthority: string;
  // The account that pays transaction fees for every operation: the backend
  // service's own payer keypair, never one of the personas.
  feePayer: string;
  // The Token-2022 extensions enabled on this mint. Extension names are
  // protocol identifiers and stay in English across every locale, like a
  // program id would.
  extensions: string[];
  autoApproveNewAccounts: boolean;
  // Reported by the backend from its RPC URL; "devnet" for the default.
  cluster: string;
}

export interface ConfidentialAmount {
  ciphertext: string; // short fingerprint of the on-chain ElGamal ciphertext
  // Only ever non-null when the backend itself resolved the caller as this
  // account's owner (see rust-service's X-Auth-Tokens handling) — `null`
  // means the server withheld it, not that the value happens to be unknown.
  decrypted: number | null;
}

export interface AccountBalanceState {
  accountId: string;
  publicBalance: number;
  confidentialAvailable: ConfidentialAmount;
  confidentialPending: ConfidentialAmount;
}

export type ActivityType =
  | "mint"
  | "deposit"
  | "withdraw"
  | "confidential_transfer"
  | "apply_pending";

export type ActivityStatus = "confirmed" | "pending" | "failed";

// Where a failed operation most likely stopped, classified from the backend's
// error message (see lib/failure.ts). A confidential transfer is a single V1
// transaction, so there are only three places it can fail: building it
// (proof generation), the cluster rejecting it, or it never confirming.
export type FailureStage = "proof_generation" | "submission" | "confirmation";

// Stable keys for what each real transaction — or each instruction inside a
// single V1 transaction — did. Solscan reliably decodes the Token-2022
// instruction itself but shows the ZK ElGamal Proof program's verify
// instructions as "Unknown", so this is our own record of what each one was
// for, since only the backend knows.
export type EvidenceStepKind =
  | "mint"
  | "deposit"
  | "apply_pending"
  // Current operations: one V1 (SIMD-0385) transaction carrying the proof
  // verifications and the transfer/withdraw together.
  | "submit_transfer_v1"
  | "submit_withdraw_v1"
  // Synthetic per-instruction rows the drawers expand a V1 step into (see
  // components/ui/evidence-steps.tsx): the backend records one signature, but
  // the transaction still contains several instructions worth itemising.
  | "verify_equality_proof"
  | "verify_validity_proof"
  | "verify_range_proof"
  // Labels recorded by earlier, multi-transaction versions of the backend.
  // Kept so activity logs written then still render.
  | "range_proof_stage"
  | "submit_transfer"
  | "submit_withdraw"
  | "close_equality_proof"
  | "close_range_proof"
  | "close_proof_record";

export interface EvidenceStep {
  label: EvidenceStepKind;
  signature: string;
  part?: number;
}

export interface ActivityEntry {
  id: string;
  type: ActivityType;
  fromAccountId: string;
  toAccountId: string;
  status: ActivityStatus;
  privacy: PrivacyClassification;
  timestamp: number; // epoch ms
  signature: string;
  // Public (cleartext) amount for deposit/withdraw/mint. Undefined for
  // anything confidential (confidential_transfer, apply_pending).
  publicAmount?: number;
  // Populated only when the current session is authenticated as one of this
  // entry's own parties (sender/receiver) — independent of any auditor
  // action. Covers both confidential_transfer (the moved amount) and
  // apply_pending (the amount moved from pending into available balance —
  // still a confidential amount, just not a transfer between two different
  // parties). The Audit Console must never read this field — see
  // `confidential.disclosedAmount` below for why.
  partyVisibleAmount?: number;
  // Present only for confidential_transfer entries.
  confidential?: {
    ciphertext: string;
    auditorKeyGenerationId: string;
    // Only populated once an authorized auditor discloses it (see AuditDisclosure).
    // The Audit Console must read only this field — never `partyVisibleAmount`
    // above — or it ends up showing a transfer as "disclosed" just because
    // the viewer's session happens to also hold one of its parties' tokens.
    disclosedAmount?: number;
  };
  programActivity: string[];
  proofAccountRef?: string;
  // Every real transaction behind this entry, labeled with what it did —
  // empty only if the backend predates this field.
  steps: EvidenceStep[];
}

export interface AuditorKeyGeneration {
  id: string;
  generation: number;
  label: string;
  // The ElGamal public key registered on the mint's ConfidentialTransferMint
  // extension for this generation, as the backend's registry stores it.
  elgamalPubkey: string;
  createdAt: number;
  retiredAt: number | null;
  status: "active" | "retired";
}

export interface AuditDisclosure {
  id: string;
  activityId: string;
  requestedBy: string;
  reason: string;
  timestamp: number;
  keyGenerationId: string;
  decryptedAmount: number;
  outcome: "success" | "wrong_key_generation";
}
