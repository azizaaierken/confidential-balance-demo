// Thin fetch wrapper over the Rust devnet backend (rust-service/). Every
// signing key and the auditor secret live there, never in the browser — this
// client only ever sees plaintext amounts the backend has already decided are
// safe to hand back (matching the same permission model the UI already
// applies on top of the previously-simulated data).

import {
  AccountBalanceState,
  ActivityEntry,
  AuditDisclosure,
  AuditorKeyGeneration,
  EvidenceStep,
  Mint,
} from "@/lib/types";
import { shortCiphertext } from "@/lib/format";

const BASE_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8787";

export class BackendError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new BackendError(
      `Could not reach the devnet backend at ${BASE_URL}. Is rust-service running?`
    );
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) {
    throw new BackendError(body?.error ?? `Backend request to ${path} failed (${res.status})`);
  }
  return body as T;
}

// ---- Raw wire shapes (camelCase, matching rust-service/src/bin/server.rs) ----

interface RawMint {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  programId: string;
  zkProofProgramId: string;
  confidentialTransferAuthority: string;
  extensions: string[];
  autoApproveNewAccounts: boolean;
  cluster: string;
}

interface RawConfidentialAmount {
  ciphertext: string;
  decrypted: number;
}

interface RawBalance {
  accountId: string;
  address: string;
  tokenAccount: string;
  publicBalance: number;
  confidentialAvailable: RawConfidentialAmount;
  confidentialPending: RawConfidentialAmount;
}

interface RawEvidenceStep {
  label: string;
  signature: string;
  part?: number;
}

interface RawActivityEntry {
  id: string;
  type: string;
  fromAccountId: string;
  toAccountId: string;
  status: string;
  privacy: string;
  timestamp: number;
  signature: string;
  signatures: string[];
  steps?: RawEvidenceStep[];
  publicAmountUi?: number;
  auditorKeyGenerationId?: string;
  auditorCiphertextLoHex?: string;
  auditorCiphertextHiHex?: string;
  disclosedAmountUi?: number;
  originAgentProposalId?: string;
}

interface RawAuditDisclosure {
  id: string;
  activityId: string;
  requestedBy: string;
  reason: string;
  timestamp: number;
  keyGenerationId: string;
  decryptedAmountUi: number;
  outcome: string;
}

interface RawState {
  ok: boolean;
  mint: RawMint;
  totalSupply: number;
  balances: Record<string, RawBalance>;
  auditorKeyGenerations: AuditorKeyGeneration[];
  activity: RawActivityEntry[];
  auditDisclosures: RawAuditDisclosure[];
}

interface RawActionResponse {
  ok: boolean;
  signature: string;
  signatures: string[];
  state: RawState;
}

// ---- Mapped, frontend-shaped result ----

export interface BackendPersonaInfo {
  address: string;
  tokenAccount: string;
}

export interface BackendState {
  mint: Mint;
  totalSupply: number;
  balances: Record<string, AccountBalanceState>;
  personas: Record<string, BackendPersonaInfo>;
  auditorKeyGenerations: AuditorKeyGeneration[];
  activity: ActivityEntry[];
  auditDisclosures: AuditDisclosure[];
}

const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ZK_ELGAMAL_PROOF_PROGRAM_ID = "ZkE1Gama1Proof11111111111111111111111111111";

function programActivityFor(type: string): string[] {
  if (type === "confidential_transfer" || type === "withdraw") {
    return [TOKEN_2022_PROGRAM_ID, ZK_ELGAMAL_PROOF_PROGRAM_ID];
  }
  return [TOKEN_2022_PROGRAM_ID];
}

function toActivityEntry(a: RawActivityEntry): ActivityEntry {
  return {
    id: a.id,
    type: a.type as ActivityEntry["type"],
    fromAccountId: a.fromAccountId,
    toAccountId: a.toAccountId,
    status: a.status as ActivityEntry["status"],
    privacy: a.privacy as ActivityEntry["privacy"],
    timestamp: a.timestamp,
    signature: a.signature,
    publicAmount: a.publicAmountUi,
    confidential: a.auditorKeyGenerationId
      ? {
          ciphertext: a.auditorCiphertextLoHex ? shortCiphertext(a.auditorCiphertextLoHex) : shortCiphertext(""),
          auditorKeyGenerationId: a.auditorKeyGenerationId,
          disclosedAmount: a.disclosedAmountUi,
        }
      : undefined,
    programActivity: programActivityFor(a.type),
    proofAccountRef: a.signatures.length > 1 ? a.signatures[0] : undefined,
    originAgentProposalId: a.originAgentProposalId,
    steps: (a.steps ?? []).map(
      (s): EvidenceStep => ({
        label: s.label as EvidenceStep["label"],
        signature: s.signature,
        part: s.part,
      })
    ),
  };
}

function toAuditDisclosure(d: RawAuditDisclosure): AuditDisclosure {
  return {
    id: d.id,
    activityId: d.activityId,
    requestedBy: d.requestedBy,
    reason: d.reason,
    timestamp: d.timestamp,
    keyGenerationId: d.keyGenerationId,
    decryptedAmount: d.decryptedAmountUi,
    outcome: d.outcome as AuditDisclosure["outcome"],
  };
}

function toBalanceState(b: RawBalance): AccountBalanceState {
  return {
    accountId: b.accountId,
    publicBalance: b.publicBalance,
    confidentialAvailable: b.confidentialAvailable,
    confidentialPending: b.confidentialPending,
  };
}

function mapState(raw: RawState): BackendState {
  const balances: Record<string, AccountBalanceState> = {};
  const personas: Record<string, BackendPersonaInfo> = {};
  for (const [accountId, b] of Object.entries(raw.balances)) {
    balances[accountId] = toBalanceState(b);
    personas[accountId] = { address: b.address, tokenAccount: b.tokenAccount };
  }
  return {
    mint: {
      address: raw.mint.address,
      name: raw.mint.name,
      symbol: raw.mint.symbol,
      decimals: raw.mint.decimals,
      programId: raw.mint.programId,
      zkProofProgramId: raw.mint.zkProofProgramId,
      confidentialTransferAuthority: raw.mint.confidentialTransferAuthority,
      extensions: raw.mint.extensions,
      autoApproveNewAccounts: raw.mint.autoApproveNewAccounts,
      cluster: "devnet",
    },
    totalSupply: raw.totalSupply,
    balances,
    personas,
    auditorKeyGenerations: raw.auditorKeyGenerations,
    activity: raw.activity.map(toActivityEntry),
    auditDisclosures: raw.auditDisclosures.map(toAuditDisclosure),
  };
}

// ---- Public API ----

export async function fetchState(): Promise<BackendState> {
  const raw = await request<RawState>("/state");
  return mapState(raw);
}

export async function mintSupply(accountId: string, amount: number) {
  const raw = await request<RawActionResponse>("/mint", {
    method: "POST",
    body: JSON.stringify({ accountId, amount }),
  });
  return { signature: raw.signature, state: mapState(raw.state) };
}

export async function deposit(accountId: string, amount: number) {
  const raw = await request<RawActionResponse>("/deposit", {
    method: "POST",
    body: JSON.stringify({ accountId, amount }),
  });
  return { signature: raw.signature, state: mapState(raw.state) };
}

export async function withdraw(accountId: string, amount: number) {
  const raw = await request<RawActionResponse>("/withdraw", {
    method: "POST",
    body: JSON.stringify({ accountId, amount }),
  });
  return { signature: raw.signature, state: mapState(raw.state) };
}

export async function applyPending(accountId: string) {
  const raw = await request<RawActionResponse>("/apply-pending", {
    method: "POST",
    body: JSON.stringify({ accountId }),
  });
  return { signature: raw.signature, state: mapState(raw.state) };
}

export async function confidentialTransfer(
  fromAccountId: string,
  toAccountId: string,
  amount: number,
  originAgentProposalId?: string
) {
  const raw = await request<RawActionResponse>("/transfer", {
    method: "POST",
    body: JSON.stringify({ fromAccountId, toAccountId, amount, originAgentProposalId }),
  });
  return { signature: raw.signature, signatures: raw.signatures, state: mapState(raw.state) };
}

export async function rotateAuditorKey(): Promise<BackendState> {
  const raw = await request<RawState>("/auditor/rotate", { method: "POST" });
  return mapState(raw);
}

export async function requestAuditDisclosure(
  activityId: string,
  requestedBy: string,
  reason: string,
  keyGenerationId: string
) {
  const raw = await request<{ ok: boolean; disclosure: RawAuditDisclosure; state: RawState }>(
    "/auditor/disclose",
    {
      method: "POST",
      body: JSON.stringify({ activityId, requestedBy, reason, keyGenerationId }),
    }
  );
  return { disclosure: toAuditDisclosure(raw.disclosure), state: mapState(raw.state) };
}
