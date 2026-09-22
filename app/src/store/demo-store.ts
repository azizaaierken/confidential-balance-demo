import { create } from "zustand";
import {
  AccountBalanceState,
  ActivityEntry,
  AgentProposal,
  AuditDisclosure,
  AuditorKeyGeneration,
  DecisionRecord,
  FailureStage,
  NetworkStatus,
  PolicyCheck,
  Role,
} from "@/lib/types";
import { hydrateMintAndPersonas, MINT, RECEIVER, SENDER } from "@/lib/mock-data";
import * as backend from "@/lib/backend/client";
import { classifyFailure } from "@/lib/failure";
import { Locale } from "@/lib/i18n";

interface DemoState {
  role: Role;
  ownerAccountId: string;
  network: NetworkStatus;
  language: Locale;
  connectedWalletAddress: string;
  totalSupply: number;
  balances: Record<string, AccountBalanceState>;
  activity: ActivityEntry[];
  auditorKeyGenerations: AuditorKeyGeneration[];
  auditDisclosures: AuditDisclosure[];
  agentProposals: AgentProposal[];
  decisionRecords: DecisionRecord[];

  // Memory-only — never persisted, so a reload always starts logged out
  // (see rust-service/src/auth.rs; the backend redacts confidential fields
  // and disclosure records for any request that doesn't present the right
  // one of these).
  authTokens: backend.AuthTokens;

  backendReady: boolean;
  backendError: string | null;

  setRole: (role: Role) => void;
  setOwnerAccountId: (id: string) => void;
  setNetwork: (status: NetworkStatus) => void;
  setLanguage: (language: Locale) => void;
  hydrate: () => Promise<void>;
  reset: () => Promise<void>;

  login: (role: backend.AuthRole, password: string) => Promise<void>;
  logout: (role: backend.AuthRole) => void;

  mintSupply: (accountId: string, amount: number) => Promise<ActivityEntry>;
  deposit: (accountId: string, amount: number) => Promise<ActivityEntry>;
  withdraw: (accountId: string, amount: number) => Promise<ActivityEntry>;
  confidentialTransfer: (
    fromId: string,
    toId: string,
    amount: number,
    opts?: { originAgentProposalId?: string }
  ) => Promise<ActivityEntry>;
  applyPending: (accountId: string) => Promise<void>;

  requestAuditDisclosure: (
    activityId: string,
    requestedBy: string,
    reason: string,
    useKeyGenerationId: string
  ) => Promise<AuditDisclosure>;
  rotateAuditorKey: (confirmPassword: string) => Promise<AuditorKeyGeneration>;

  createAgentProposal: (nlIntent: string) => AgentProposal;
  updateAgentProposalAmount: (proposalId: string, amount: number) => void;
  updateAgentProposalRecipient: (
    proposalId: string,
    recipientAccountId: string
  ) => void;
  runPolicyChecks: (proposalId: string) => void;
  approveAgentProposal: (proposalId: string) => Promise<void>;
  rejectAgentProposal: (proposalId: string) => void;
  abandonAgentProposal: (proposalId: string) => void;
}

function applyBackendState(state: backend.BackendState) {
  hydrateMintAndPersonas(state.mint, state.personas);
  return {
    totalSupply: state.totalSupply,
    balances: state.balances,
    activity: state.activity,
    auditorKeyGenerations: state.auditorKeyGenerations,
    auditDisclosures: state.auditDisclosures,
  };
}

// Locking a persona (relock, or the "Refresh from devnet" reset) drops its
// auth token immediately — but without this, the previously-decrypted
// balances/amounts already sitting in the store from before the lock stay
// exactly as they were until the background `hydrate()` below finishes its
// real devnet round trip (a confirmed ~1-3s gap): the UI would show "Unlock
// owner access" right next to a still-visible decrypted figure from a
// moment ago. This redacts client-side state to match `tokens` in the same
// tick the token itself is cleared, so there's no window where they
// disagree; `hydrate()` then reconfirms (or, if a different token is still
// held, re-reveals) it for real.
function redactForTokens(
  balances: Record<string, AccountBalanceState>,
  activity: ActivityEntry[],
  tokens: backend.AuthTokens
): { balances: Record<string, AccountBalanceState>; activity: ActivityEntry[] } {
  const holds = (accountId: string) =>
    (accountId === "sender" && Boolean(tokens.sender)) ||
    (accountId === "receiver" && Boolean(tokens.receiver));

  const redactedBalances = Object.fromEntries(
    Object.entries(balances).map(([id, b]) =>
      holds(id)
        ? [id, b]
        : [
            id,
            {
              ...b,
              confidentialAvailable: { ...b.confidentialAvailable, decrypted: null },
              confidentialPending: { ...b.confidentialPending, decrypted: null },
            },
          ]
    )
  );

  const redactedActivity = activity.map((a) => {
    const isParty = holds(a.fromAccountId) || holds(a.toAccountId);
    return {
      ...a,
      partyVisibleAmount: isParty ? a.partyVisibleAmount : undefined,
      confidential: a.confidential
        ? {
            ...a.confidential,
            disclosedAmount: tokens.auditor ? a.confidential.disclosedAmount : undefined,
          }
        : a.confidential,
    };
  });

  return { balances: redactedBalances, activity: redactedActivity };
}

// The bank-hosted agent always acts for the sender. It used to follow
// whichever account the sidebar had last selected, so stepping through the
// receiver's page and then opening Agent Payments silently changed who was
// paying — reflected only in the small "Acting for" chip, while every other
// word on the page stayed identical.
export const AGENT_ACTING_ACCOUNT_ID = SENDER.id;

// The demo's single bank operator persona — named in an approval when one
// signs off, and in the outcome when one declines.
const OPS_APPROVER = "Ops Approver — J. Chan";

// Bank-controlled case reference, never a public chain field. A signature
// makes the best reference when there is one; a blocked or failed payment has
// none, so fall back to the proposal id minus its `proposal-` prefix —
// slicing the prefixed id would make every such case read "CASE-PROPOSAL".
function caseRef(signatureOrProposalId: string): string {
  return `CASE-${signatureOrProposalId.replace(/^proposal-/, "").slice(0, 8).toUpperCase()}`;
}

// Shared spine of a decision record, so the policy-blocked and executed paths
// can't drift apart on the fields that describe the same decision.
function baseDecisionRecord(proposal: AgentProposal, fromAccountId: string) {
  return {
    id: `decision-${crypto.randomUUID()}`,
    agentProposalId: proposal.id,
    fromAccountId,
    toAccountId: proposal.parsed.recipientAccountId ?? "",
    input: proposal.naturalLanguageIntent,
    policyVersion: "policy-v2.3.1",
    modelVersion: "bank-agent-model-2026-08",
    createdAt: Date.now(),
  };
}

function activeAuditorKeyGeneration(
  gens: AuditorKeyGeneration[]
): AuditorKeyGeneration {
  const active = gens.find((g) => g.status === "active");
  return active ?? gens[gens.length - 1];
}

export const useDemoStore = create<DemoState>((set, get) => ({
  role: "owner",
  ownerAccountId: SENDER.id,
  network: "connected",
  language: "en",
  connectedWalletAddress: SENDER.address,
  totalSupply: 0,
  balances: {},
  activity: [],
  auditorKeyGenerations: [],
  auditDisclosures: [],
  agentProposals: [],
  decisionRecords: [],
  authTokens: {},
  backendReady: false,
  backendError: null,

  setRole: (role) => set({ role }),
  setOwnerAccountId: (id) =>
    set({
      ownerAccountId: id,
      connectedWalletAddress: id === SENDER.id ? SENDER.address : RECEIVER.address,
    }),
  setNetwork: (status) => set({ network: status }),
  setLanguage: (language) => set({ language }),

  hydrate: async () => {
    try {
      const state = await backend.fetchState(get().authTokens);
      set({ ...applyBackendState(state), backendReady: true, backendError: null });
    } catch (e) {
      set({ backendReady: false, backendError: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  },

  reset: async () => {
    set((s) => ({
      role: "owner",
      ownerAccountId: SENDER.id,
      network: "connected",
      connectedWalletAddress: SENDER.address,
      agentProposals: [],
      decisionRecords: [],
      authTokens: {},
      ...redactForTokens(s.balances, s.activity, {}),
    }));
    await get().hydrate();
  },

  login: async (role, password) => {
    const token = await backend.login(role, password);
    // Fetch the freshly-unlocked state *before* flipping authTokens, so the
    // UI never shows "unlocked" for the moment before the now-decryptable
    // data has actually arrived (two real devnet RPC reads happen inside
    // /state, so this isn't instant) — token and data land in one render.
    const tokens = { ...get().authTokens, [role]: token };
    const state = await backend.fetchState(tokens);
    set({ authTokens: tokens, ...applyBackendState(state), backendReady: true, backendError: null });
  },

  logout: (role) => {
    set((s) => {
      const next = { ...s.authTokens };
      delete next[role];
      return { authTokens: next, ...redactForTokens(s.balances, s.activity, next) };
    });
    get().hydrate().catch(() => {
      // surfaced via backendError already; relocking shouldn't throw further
    });
  },

  mintSupply: async (accountId, amount) => {
    const { signature, state } = await backend.mintSupply(accountId, amount, get().authTokens);
    set(applyBackendState(state));
    const entry = state.activity.find((a) => a.signature === signature);
    if (!entry) throw new Error("mint succeeded but activity entry was not found");
    return entry;
  },

  deposit: async (accountId, amount) => {
    const { signature, state } = await backend.deposit(accountId, amount, get().authTokens);
    set(applyBackendState(state));
    const entry = state.activity.find((a) => a.signature === signature);
    if (!entry) throw new Error("deposit succeeded but activity entry was not found");
    return entry;
  },

  withdraw: async (accountId, amount) => {
    const { signature, state } = await backend.withdraw(accountId, amount, get().authTokens);
    set(applyBackendState(state));
    const entry = state.activity.find((a) => a.signature === signature);
    if (!entry) throw new Error("withdraw succeeded but activity entry was not found");
    return entry;
  },

  confidentialTransfer: async (fromId, toId, amount, opts) => {
    const { signature, state } = await backend.confidentialTransfer(
      fromId,
      toId,
      amount,
      opts?.originAgentProposalId,
      get().authTokens
    );
    set(applyBackendState(state));
    const entry = state.activity.find((a) => a.signature === signature);
    if (!entry) throw new Error("transfer succeeded but activity entry was not found");
    return entry;
  },

  applyPending: async (accountId) => {
    const { state } = await backend.applyPending(accountId, get().authTokens);
    set(applyBackendState(state));
  },

  requestAuditDisclosure: async (activityId, requestedBy, reason, useKeyGenerationId) => {
    const { disclosure, state } = await backend.requestAuditDisclosure(
      activityId,
      requestedBy,
      reason,
      useKeyGenerationId,
      get().authTokens
    );
    set(applyBackendState(state));
    return disclosure;
  },

  rotateAuditorKey: async (confirmPassword) => {
    const state = await backend.rotateAuditorKey(confirmPassword, get().authTokens);
    set(applyBackendState(state));
    return activeAuditorKeyGeneration(state.auditorKeyGenerations);
  },

  createAgentProposal: (nlIntent) => {
    const parsed = parseIntent(nlIntent);
    const proposal: AgentProposal = {
      id: `proposal-${crypto.randomUUID()}`,
      createdAt: Date.now(),
      naturalLanguageIntent: nlIntent,
      parsed,
      policyChecks: [],
      requiresHumanApproval: true,
      dataGivenToComponents: {
        agent: ["nlIntent", "parsedFields"],
        policyService: ["parsedRecipient", "parsedAmount", "senderLimits"],
        signer: ["finalTx", "proofInputs", "feePayer"],
      },
      status: parsed.ambiguous ? "needs_clarification" : "policy_review",
    };
    set((s) => ({ agentProposals: [proposal, ...s.agentProposals] }));
    return proposal;
  },

  updateAgentProposalAmount: (proposalId, amount) => {
    set((s) => ({
      agentProposals: s.agentProposals.map((p) =>
        p.id === proposalId
          ? {
              ...p,
              parsed: { ...p.parsed, amount, ambiguous: false },
              status: "policy_review",
            }
          : p
      ),
    }));
  },

  updateAgentProposalRecipient: (proposalId, recipientAccountId) => {
    set((s) => ({
      agentProposals: s.agentProposals.map((p) =>
        p.id === proposalId
          ? {
              ...p,
              parsed: {
                ...p.parsed,
                recipientAccountId,
                ambiguous: p.parsed.amount === null,
              },
              status: p.parsed.amount === null ? "needs_clarification" : "policy_review",
            }
          : p
      ),
    }));
  },

  runPolicyChecks: (proposalId) => {
    const state = get();
    const proposal = state.agentProposals.find((p) => p.id === proposalId);
    if (!proposal) return;
    const checks = evaluatePolicy(proposal, state);
    const blocked = checks.filter((c) => c.status === "fail").map((c) => c.key);

    // A policy block is itself an auditable decision: the agent proposed a
    // payment and the bank stopped it. Nothing reaches the chain and no
    // operator ever sees it, so without a record here the whole episode
    // would leave no trace for an auditor at all.
    const decisionRecord: DecisionRecord | null = blocked.length
      ? {
          ...baseDecisionRecord(proposal, AGENT_ACTING_ACCOUNT_ID),
          correlationRef: caseRef(proposalId),
          toolActions: [
            "parse_intent",
            "resolve_recipient",
            "check_daily_limit",
            "check_allowlist",
          ],
          // Policy stopped this before it ever reached a human.
          approvals: [],
          outcome: { failed: true, stage: "policy_checks" },
          blockedByPolicyChecks: blocked,
        }
      : null;

    set((s) => ({
      decisionRecords: decisionRecord ? [decisionRecord, ...s.decisionRecords] : s.decisionRecords,
      agentProposals: s.agentProposals.map((p) =>
        p.id === proposalId
          ? {
              ...p,
              policyChecks: checks,
              status: blocked.length ? "rejected" : "awaiting_approval",
              decisionRecordId: decisionRecord?.id ?? p.decisionRecordId,
            }
          : p
      ),
    }));
  },

  approveAgentProposal: async (proposalId) => {
    const state = get();
    const proposal = state.agentProposals.find((p) => p.id === proposalId);
    if (!proposal || proposal.parsed.recipientAccountId === null || proposal.parsed.amount === null)
      return;

    set((s) => ({
      agentProposals: s.agentProposals.map((p) =>
        p.id === proposalId ? { ...p, status: "executing" } : p
      ),
    }));

    let entry: ActivityEntry | null = null;
    let failureStage: FailureStage | undefined;
    let failureReason: string | undefined;
    try {
      entry = await get().confidentialTransfer(
        AGENT_ACTING_ACCOUNT_ID,
        proposal.parsed.recipientAccountId,
        proposal.parsed.amount,
        { originAgentProposalId: proposalId }
      );
    } catch (e) {
      failureReason = e instanceof Error ? e.message : String(e);
      failureStage = classifyFailure(failureReason);
    }

    const decisionRecord: DecisionRecord = {
      ...baseDecisionRecord(proposal, AGENT_ACTING_ACCOUNT_ID),
      correlationRef: caseRef(entry?.signature ?? proposalId),
      toolActions: [
        "parse_intent",
        "resolve_recipient",
        "check_daily_limit",
        "check_allowlist",
        "construct_confidential_transfer",
      ],
      approvals: [
        { by: OPS_APPROVER, at: Date.now(), role: "bank_policy_service" },
      ],
      outcome: failureStage ? { failed: true, stage: failureStage } : { failed: false },
    };

    set((s) => ({
      decisionRecords: [decisionRecord, ...s.decisionRecords],
      agentProposals: s.agentProposals.map((p) =>
        p.id === proposalId
          ? entry
            ? {
                ...p,
                status: "executed",
                resultingActivityId: entry.id,
                decisionRecordId: decisionRecord.id,
              }
            : {
                ...p,
                status: "failed",
                failureStage,
                failureReason,
                decisionRecordId: decisionRecord.id,
              }
          : p
      ),
    }));
  },

  abandonAgentProposal: (proposalId) => {
    const state = get();
    const proposal = state.agentProposals.find((p) => p.id === proposalId);
    if (!proposal) return;

    // Nothing was decided here — but an instruction the agent couldn't carry
    // forward, and that was then dropped, is still evidence about how the
    // agent handled it. Only the steps that actually ran are listed: parsing
    // and recipient resolution, never the policy checks it never reached.
    const decisionRecord: DecisionRecord = {
      ...baseDecisionRecord(proposal, AGENT_ACTING_ACCOUNT_ID),
      correlationRef: caseRef(proposalId),
      toolActions: ["parse_intent", "resolve_recipient"],
      approvals: [],
      outcome: { failed: true },
      abandoned: { at: Date.now() },
    };

    set((s) => ({
      decisionRecords: [decisionRecord, ...s.decisionRecords],
      agentProposals: s.agentProposals.map((p) =>
        p.id === proposalId
          ? { ...p, status: "abandoned", decisionRecordId: decisionRecord.id }
          : p
      ),
    }));
  },

  rejectAgentProposal: (proposalId) => {
    const state = get();
    const proposal = state.agentProposals.find((p) => p.id === proposalId);
    if (!proposal) return;

    // Policy cleared this and a person still said no. That decision is the
    // auditable event — there's no transaction and no policy failure to point
    // at afterwards, so without a record the refusal leaves no trace of who
    // made it.
    const decisionRecord: DecisionRecord = {
      ...baseDecisionRecord(proposal, AGENT_ACTING_ACCOUNT_ID),
      correlationRef: caseRef(proposalId),
      toolActions: [
        "parse_intent",
        "resolve_recipient",
        "check_daily_limit",
        "check_allowlist",
      ],
      // Declining isn't an approval — it's recorded as the outcome instead,
      // attributed below.
      approvals: [],
      outcome: { failed: true },
      declinedByOperator: { by: OPS_APPROVER, at: Date.now() },
    };

    set((s) => ({
      decisionRecords: [decisionRecord, ...s.decisionRecords],
      agentProposals: s.agentProposals.map((p) =>
        p.id === proposalId
          ? { ...p, status: "rejected", decisionRecordId: decisionRecord.id }
          : p
      ),
    }));
  },
}));

// Real network-status derivation (replaces the old click-to-cycle sidebar
// control): every backend request reports success/failure here, and once
// the initial connection has succeeded, a later failure means devnet or the
// backend hiccuped, not that we're disconnected — "degraded", not "disconnected".
backend.onNetworkStatus((ok) => {
  if (!useDemoStore.getState().backendReady) return;
  useDemoStore.setState({ network: ok ? "connected" : "degraded" });
});

function parseIntent(text: string): AgentProposal["parsed"] {
  const lower = text.toLowerCase();
  const amountMatch = lower.match(/(\d[\d,]*(?:\.\d+)?)/);
  const amount = amountMatch
    ? parseFloat(amountMatch[1].replace(/,/g, ""))
    : null;

  let recipientAccountId: string | null = null;
  if (lower.includes("harbour") || lower.includes("receiver")) {
    recipientAccountId = RECEIVER.id;
  } else if (lower.includes("lotus") || lower.includes("sender")) {
    recipientAccountId = SENDER.id;
  }

  const ambiguous = recipientAccountId === null || amount === null;
  return {
    recipientAccountId,
    asset: MINT.symbol,
    amount,
    timing: lower.includes("tomorrow") ? "scheduledTomorrow" : "immediate",
    ambiguous,
    ambiguityKey: ambiguous
      ? recipientAccountId === null
        ? "recipientUnresolved"
        : "amountUnresolved"
      : undefined,
  };
}

function evaluatePolicy(
  proposal: AgentProposal,
  state: DemoState
): PolicyCheck[] {
  const amount = proposal.parsed.amount ?? 0;
  const senderBalance =
    state.balances[AGENT_ACTING_ACCOUNT_ID]?.confidentialAvailable.decrypted;
  const DAILY_LIMIT = 100_000;

  const checks: PolicyCheck[] = [
    {
      key: "recipientAllowlist",
      // Unresolved fails, and so does the sender itself: the parser will
      // happily resolve "pay Harbour..." to Harbour while acting *for*
      // Harbour, which is not a payment at all.
      status:
        proposal.parsed.recipientAccountId != null &&
        proposal.parsed.recipientAccountId !== AGENT_ACTING_ACCOUNT_ID
          ? "pass"
          : "fail",
      failReason:
        proposal.parsed.recipientAccountId === AGENT_ACTING_ACCOUNT_ID
          ? "selfPayment"
          : undefined,
    },
    {
      key: "availableBalance",
      // The bank agent only sees this session's own unlocked confidential
      // balances, same as anyone else — if the sender isn't unlocked here,
      // this can't be verified locally, so it's deferred rather than
      // fabricated: the real balance check happens when the transfer executes.
      status:
        senderBalance == null ? "requires_approval" : amount <= senderBalance ? "pass" : "fail",
    },
    {
      key: "dailyLimit",
      status: amount <= DAILY_LIMIT ? "pass" : "fail",
      dailyLimitValue: `${DAILY_LIMIT.toLocaleString()} ${MINT.symbol}`,
    },
    {
      key: "humanApproval",
      status: "requires_approval",
    },
  ];
  return checks;
}
