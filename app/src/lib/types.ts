// Domain model for the simulated Confidential Balance demo.
// Nothing here talks to a real RPC — see lib/mock-data.ts and store/demo-store.ts.
// Shapes intentionally mirror the real Token-2022 Confidential Transfer data model
// (ciphertext fields, pending vs available, per-transfer auditor ciphertext, key
// generations) so swapping in a live devnet client later is a data-source change,
// not a UI rewrite.

export type Role = "owner" | "public" | "auditor";

export type NetworkStatus = "connected" | "degraded" | "disconnected";

export type PrivacyClassification = "public" | "confidential";

export interface Persona {
  id: string;
  name: string;
  initials: string;
  address: string; // demo devnet-style base58 address
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
  // The Token-2022 extensions enabled on this mint. Extension names are
  // protocol identifiers and stay in English across every locale, like a
  // program id would.
  extensions: string[];
  autoApproveNewAccounts: boolean;
  cluster: "devnet";
}

export interface ConfidentialAmount {
  ciphertext: string; // opaque, display-only stand-in for ElGamal ciphertext
  decrypted: number; // only ever read when the current role is authorized
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

export type FailureStage =
  | "proposal_parsing"
  | "policy_checks"
  | "proof_generation"
  | "wallet_approval"
  | "submission"
  | "confirmation";

// Stable keys for each real transaction inside a multi-transaction operation.
// Solscan only reliably decodes the Token-2022 instruction itself — the
// separate ZK ElGamal Proof program instructions (context-state
// create/verify/close) that make up the rest of a confidential transfer or
// withdraw show up there as "Unknown: Unknown" — so this is our own record of
// what each transaction was actually for, since only the backend knows.
export type EvidenceStepKind =
  | "mint"
  | "deposit"
  | "apply_pending"
  | "verify_equality_proof"
  | "verify_validity_proof"
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
  // Public (cleartext) amount for deposit/withdraw. Undefined for confidential transfers.
  publicAmount?: number;
  // Present only for confidential_transfer entries.
  confidential?: {
    ciphertext: string;
    auditorKeyGenerationId: string;
    // Only populated once an authorized auditor discloses it (see AuditDisclosure).
    disclosedAmount?: number;
  };
  programActivity: string[];
  proofAccountRef?: string;
  // Every real transaction behind this entry, labeled with what it did —
  // empty only if the backend predates this field.
  steps: EvidenceStep[];
  // Reason text is looked up from the current locale's copy at render time,
  // keyed by stage — never baked into the record (see lib/i18n).
  failure?: {
    stage: FailureStage;
  };
  originAgentProposalId?: string;
}

export interface AuditorKeyGeneration {
  id: string;
  generation: number;
  label: string;
  // Display-only stand-in for the ElGamal public key registered on the mint's
  // ConfidentialTransferMint extension for this generation.
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

export type PolicyCheckStatus = "pass" | "fail" | "requires_approval";

export type PolicyCheckKey =
  | "recipientAllowlist"
  | "availableBalance"
  | "dailyLimit"
  | "humanApproval";

export interface PolicyCheck {
  key: PolicyCheckKey;
  status: PolicyCheckStatus;
  // Only dailyLimit uses this, to interpolate the configured limit.
  dailyLimitValue?: string;
}

export type AgentProposalStatus =
  | "parsing"
  | "needs_clarification"
  | "policy_review"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "executing"
  | "executed"
  | "failed";

export type AgentProposalTiming = "immediate" | "scheduledTomorrow";
export type AmbiguityKey = "recipientUnresolved" | "amountUnresolved";
export type DataItemKey =
  | "nlIntent"
  | "parsedFields"
  | "parsedRecipient"
  | "parsedAmount"
  | "senderLimits"
  | "finalTx"
  | "proofInputs"
  | "feePayer";

export interface AgentProposal {
  id: string;
  createdAt: number;
  naturalLanguageIntent: string;
  parsed: {
    recipientAccountId: string | null;
    asset: string;
    amount: number | null;
    timing: AgentProposalTiming;
    ambiguous: boolean;
    ambiguityKey?: AmbiguityKey;
  };
  policyChecks: PolicyCheck[];
  requiresHumanApproval: boolean;
  dataGivenToComponents: {
    agent: DataItemKey[];
    policyService: DataItemKey[];
    signer: DataItemKey[];
  };
  status: AgentProposalStatus;
  resultingActivityId?: string;
  decisionRecordId?: string;
  // Set only when status is "failed" — the real error the backend returned,
  // not a canned per-stage description (see lib/failure.ts).
  failureStage?: FailureStage;
  failureReason?: string;
}

export interface DecisionRecord {
  id: string;
  agentProposalId: string;
  correlationRef: string; // bank-controlled reference, not a public chain field
  input: string;
  policyVersion: string;
  modelVersion: string;
  toolActions: string[];
  approvals: { by: string; at: number; role: string }[];
  // Reason text is looked up from the current locale's copy at render time.
  outcome: { failed: boolean; stage?: FailureStage };
  createdAt: number;
}

export interface DemoAccountSummary {
  persona: Persona;
  balances: AccountBalanceState;
}
