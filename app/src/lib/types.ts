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
  | "close_proof_record"
  // V1 (SIMD-0385) transactions: proof verification + the transfer/withdraw
  // itself now fit in one transaction, so these replace the whole
  // verify/stage/submit/close sequence above for any operation recorded
  // after the V1 rewrite. Older, still-present activity entries keep using
  // the keys above — kept rather than removed for that reason.
  | "submit_transfer_v1"
  | "submit_withdraw_v1"
  // Synthetic — not a backend-recorded step. The backend only ever records
  // one real signature for a V1 transfer/withdraw now, but that transaction
  // still contains several instructions; the drawer expands that one
  // signature into per-instruction rows (see send-transfer-drawer.tsx /
  // deposit-withdraw-drawer.tsx) so the breakdown Solscan can't give —
  // itemizing what's actually in the transaction — stays visible in-app.
  | "verify_range_proof";

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
  // recipientAllowlist can fail two ways — nothing resolved, or what resolved
  // is the sender itself — and saying "no recipient resolved" for the second
  // is just wrong: one did, it's you.
  failReason?: "selfPayment";
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
  | "failed"
  // Given up on by the person who issued it, before the bank decided
  // anything — distinct from the bank refusing it.
  | "abandoned";

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
  // Who the agent was paying, on whose behalf. Recorded here rather than read
  // off the resulting transfer because a failed agent payment never produces
  // one — and that's exactly the case an auditor needs to investigate.
  fromAccountId: string;
  toAccountId: string;
  input: string;
  policyVersion: string;
  modelVersion: string;
  toolActions: string[];
  approvals: { by: string; at: number; role: string }[];
  // Reason text is looked up from the current locale's copy at render time.
  outcome: { failed: boolean; stage?: FailureStage };
  // Set when bank policy blocked the payment before it could execute, naming
  // the checks that failed. A blocked payment never reaches the chain and
  // never reaches an operator, so this is the only record that it was ever
  // proposed at all.
  blockedByPolicyChecks?: PolicyCheckKey[];
  // Set when policy passed but a human operator declined to approve. Distinct
  // from a policy block: the rules allowed it and a person said no, which is
  // the part an auditor needs attributed to someone.
  declinedByOperator?: { by: string; at: number };
  // Set when the instruction was dropped before it ever reached policy —
  // typically one the agent couldn't resolve. Nothing was decided, so this
  // records only that an instruction came in and went nowhere, which is
  // itself evidence about how the agent handled it. Deliberately names no
  // person: the approver hasn't entered the flow at this stage, and the demo
  // has no separate identity for whoever withdrew it. The instruction's own
  // customer is already on the record as `fromAccountId`.
  abandoned?: { at: number };
  createdAt: number;
}

export interface DemoAccountSummary {
  persona: Persona;
  balances: AccountBalanceState;
}
