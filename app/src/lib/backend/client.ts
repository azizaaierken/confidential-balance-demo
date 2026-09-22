// Thin fetch wrapper over the Rust devnet backend (rust-service/). Every
// signing key and the auditor secret live there, never in the browser — this
// client only ever sees plaintext amounts the backend has already decided
// (from the auth tokens sent with the request) are safe to hand back.

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

// Which roles the viewer has switched on in the UI (any combination of the
// sender, the receiver and the auditor). Sent on every request as one
// `X-Demo-Roles` header so the backend reveals exactly what that combination
// is entitled to see and allows exactly the actions it may take. This is a
// demo switch, not a credential — see rust-service/src/auth.rs.
export type ViewRole = "sender" | "receiver" | "auditor";
export type ViewRoles = Record<ViewRole, boolean>;

export const NO_ROLES: ViewRoles = { sender: false, receiver: false, auditor: false };

function rolesHeader(roles?: ViewRoles): Record<string, string> {
  const on = (["sender", "receiver", "auditor"] as ViewRole[]).filter((r) => roles?.[r]);
  return on.length ? { "X-Demo-Roles": on.join(",") } : {};
}

// Reports request-level connectivity (reachable + ok vs. not) after every
// call — the store uses this to derive a real network-status indicator
// instead of the click-to-cycle placeholder it used to have.
type NetworkListener = (ok: boolean) => void;
let networkListener: NetworkListener | null = null;
export function onNetworkStatus(fn: NetworkListener) {
  networkListener = fn;
}

async function request<T>(path: string, init?: RequestInit, roles?: ViewRoles): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...rolesHeader(roles),
        ...init?.headers,
      },
    });
  } catch {
    networkListener?.(false);
    throw new BackendError(
      `Could not reach the devnet backend at ${BASE_URL}. Is rust-service running?`
    );
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) {
    networkListener?.(false);
    throw new BackendError(body?.error ?? `Backend request to ${path} failed (${res.status})`);
  }
  networkListener?.(true);
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
  feePayer: string;
  extensions: string[];
  autoApproveNewAccounts: boolean;
  cluster: string;
}

interface RawConfidentialAmount {
  ciphertext: string;
  decrypted: number | null;
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
  partyVisibleAmountUi?: number;
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
    partyVisibleAmount: a.partyVisibleAmountUi,
    confidential: a.auditorKeyGenerationId
      ? {
          ciphertext: a.auditorCiphertextLoHex ? shortCiphertext(a.auditorCiphertextLoHex) : shortCiphertext(""),
          auditorKeyGenerationId: a.auditorKeyGenerationId,
          disclosedAmount: a.disclosedAmountUi,
        }
      : undefined,
    programActivity: programActivityFor(a.type),
    proofAccountRef: a.signatures.length > 1 ? a.signatures[0] : undefined,
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
      feePayer: raw.mint.feePayer,
      extensions: raw.mint.extensions,
      autoApproveNewAccounts: raw.mint.autoApproveNewAccounts,
      cluster: raw.mint.cluster,
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

// Reading state is idempotent, and both the public devnet RPC behind the
// backend and the local hop to it can fail transiently, so a read retries a
// couple of times before it is reported as a failure. Actions (POST) are
// never retried here: a transfer that timed out may still have landed.
export async function fetchState(roles?: ViewRoles): Promise<BackendState> {
  const attempts = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const raw = await request<RawState>("/state", undefined, roles);
      return mapState(raw);
    } catch (e) {
      lastError = e;
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  throw lastError;
}

export async function mintSupply(accountId: string, amount: number, roles?: ViewRoles) {
  const raw = await request<RawActionResponse>(
    "/mint",
    { method: "POST", body: JSON.stringify({ accountId, amount }) },
    roles
  );
  return { signature: raw.signature, state: mapState(raw.state) };
}

export async function deposit(accountId: string, amount: number, roles?: ViewRoles) {
  const raw = await request<RawActionResponse>(
    "/deposit",
    { method: "POST", body: JSON.stringify({ accountId, amount }) },
    roles
  );
  return { signature: raw.signature, state: mapState(raw.state) };
}

export async function withdraw(accountId: string, amount: number, roles?: ViewRoles) {
  const raw = await request<RawActionResponse>(
    "/withdraw",
    { method: "POST", body: JSON.stringify({ accountId, amount }) },
    roles
  );
  return { signature: raw.signature, state: mapState(raw.state) };
}

export async function applyPending(accountId: string, roles?: ViewRoles) {
  const raw = await request<RawActionResponse>(
    "/apply-pending",
    { method: "POST", body: JSON.stringify({ accountId }) },
    roles
  );
  return { signature: raw.signature, state: mapState(raw.state) };
}

export async function confidentialTransfer(
  fromAccountId: string,
  toAccountId: string,
  amount: number,
  roles?: ViewRoles
) {
  const raw = await request<RawActionResponse>(
    "/transfer",
    { method: "POST", body: JSON.stringify({ fromAccountId, toAccountId, amount }) },
    roles
  );
  return { signature: raw.signature, signatures: raw.signatures, state: mapState(raw.state) };
}

export interface TransferSimulation {
  success: boolean;
  error: string | null;
  logs: string[];
  unitsConsumed: number | null;
  feeLamports: number | null;
}

/// Asks the backend to build the real transaction and have devnet simulate
/// it. Throws if the transaction couldn't be built or the cluster couldn't be
/// reached — which is not the same as "this transfer would fail", so callers
/// should surface that case distinctly rather than as a verdict.
export async function simulateTransfer(
  fromAccountId: string,
  toAccountId: string,
  amount: number,
  roles?: ViewRoles
): Promise<TransferSimulation> {
  const raw = await request<TransferSimulation & { ok: boolean }>(
    "/transfer/simulate",
    { method: "POST", body: JSON.stringify({ fromAccountId, toAccountId, amount }) },
    roles
  );
  return {
    success: raw.success,
    error: raw.error,
    logs: raw.logs ?? [],
    unitsConsumed: raw.unitsConsumed,
    feeLamports: raw.feeLamports,
  };
}

export async function rotateAuditorKey(roles?: ViewRoles): Promise<BackendState> {
  const raw = await request<RawState>("/auditor/rotate", { method: "POST", body: "{}" }, roles);
  return mapState(raw);
}

export async function requestAuditDisclosure(
  activityId: string,
  requestedBy: string,
  reason: string,
  keyGenerationId: string,
  roles?: ViewRoles
) {
  const raw = await request<{ ok: boolean; disclosure: RawAuditDisclosure; state: RawState }>(
    "/auditor/disclose",
    { method: "POST", body: JSON.stringify({ activityId, requestedBy, reason, keyGenerationId }) },
    roles
  );
  return { disclosure: toAuditDisclosure(raw.disclosure), state: mapState(raw.state) };
}
