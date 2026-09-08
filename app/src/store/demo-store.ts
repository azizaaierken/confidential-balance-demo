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

  backendReady: boolean;
  backendError: string | null;

  setRole: (role: Role) => void;
  setOwnerAccountId: (id: string) => void;
  setNetwork: (status: NetworkStatus) => void;
  setLanguage: (language: Locale) => void;
  hydrate: () => Promise<void>;
  reset: () => Promise<void>;

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
  rotateAuditorKey: () => Promise<AuditorKeyGeneration>;

  createAgentProposal: (nlIntent: string) => AgentProposal;
  updateAgentProposalAmount: (proposalId: string, amount: number) => void;
  updateAgentProposalRecipient: (
    proposalId: string,
    recipientAccountId: string
  ) => void;
  runPolicyChecks: (proposalId: string) => void;
  approveAgentProposal: (proposalId: string) => Promise<void>;
  rejectAgentProposal: (proposalId: string) => void;
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
      const state = await backend.fetchState();
      set({ ...applyBackendState(state), backendReady: true, backendError: null });
    } catch (e) {
      set({ backendReady: false, backendError: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  },

  reset: async () => {
    set({
      role: "owner",
      ownerAccountId: SENDER.id,
      network: "connected",
      connectedWalletAddress: SENDER.address,
      agentProposals: [],
      decisionRecords: [],
    });
    await get().hydrate();
  },

  mintSupply: async (accountId, amount) => {
    const { signature, state } = await backend.mintSupply(accountId, amount);
    set(applyBackendState(state));
    const entry = state.activity.find((a) => a.signature === signature);
    if (!entry) throw new Error("mint succeeded but activity entry was not found");
    return entry;
  },

  deposit: async (accountId, amount) => {
    const { signature, state } = await backend.deposit(accountId, amount);
    set(applyBackendState(state));
    const entry = state.activity.find((a) => a.signature === signature);
    if (!entry) throw new Error("deposit succeeded but activity entry was not found");
    return entry;
  },

  withdraw: async (accountId, amount) => {
    const { signature, state } = await backend.withdraw(accountId, amount);
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
      opts?.originAgentProposalId
    );
    set(applyBackendState(state));
    const entry = state.activity.find((a) => a.signature === signature);
    if (!entry) throw new Error("transfer succeeded but activity entry was not found");
    return entry;
  },

  applyPending: async (accountId) => {
    const { state } = await backend.applyPending(accountId);
    set(applyBackendState(state));
  },

  requestAuditDisclosure: async (activityId, requestedBy, reason, useKeyGenerationId) => {
    const { disclosure, state } = await backend.requestAuditDisclosure(
      activityId,
      requestedBy,
      reason,
      useKeyGenerationId
    );
    set(applyBackendState(state));
    return disclosure;
  },

  rotateAuditorKey: async () => {
    const state = await backend.rotateAuditorKey();
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
    const anyFail = checks.some((c) => c.status === "fail");
    set((s) => ({
      agentProposals: s.agentProposals.map((p) =>
        p.id === proposalId
          ? {
              ...p,
              policyChecks: checks,
              status: anyFail ? "rejected" : "awaiting_approval",
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
        state.ownerAccountId,
        proposal.parsed.recipientAccountId,
        proposal.parsed.amount,
        { originAgentProposalId: proposalId }
      );
    } catch (e) {
      failureReason = e instanceof Error ? e.message : String(e);
      failureStage = classifyFailure(failureReason);
    }

    const decisionRecord: DecisionRecord = {
      id: `decision-${crypto.randomUUID()}`,
      agentProposalId: proposalId,
      correlationRef: `CASE-${(entry?.signature ?? proposalId).slice(0, 8).toUpperCase()}`,
      input: proposal.naturalLanguageIntent,
      policyVersion: "policy-v2.3.1",
      modelVersion: "bank-agent-model-2026-08",
      toolActions: [
        "parse_intent",
        "resolve_recipient",
        "check_daily_limit",
        "check_allowlist",
        "construct_confidential_transfer",
      ],
      approvals: [
        { by: "Ops Approver — J. Chan", at: Date.now(), role: "bank_policy_service" },
      ],
      outcome: failureStage ? { failed: true, stage: failureStage } : { failed: false },
      createdAt: Date.now(),
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

  rejectAgentProposal: (proposalId) => {
    set((s) => ({
      agentProposals: s.agentProposals.map((p) =>
        p.id === proposalId ? { ...p, status: "rejected" } : p
      ),
    }));
  },
}));

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
    state.balances[state.ownerAccountId]?.confidentialAvailable.decrypted ?? 0;
  const DAILY_LIMIT = 100_000;

  const checks: PolicyCheck[] = [
    {
      key: "recipientAllowlist",
      status: proposal.parsed.recipientAccountId != null ? "pass" : "fail",
    },
    {
      key: "availableBalance",
      status: amount <= senderBalance ? "pass" : "fail",
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
