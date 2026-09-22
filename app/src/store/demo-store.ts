import { create } from "zustand";
import {
  AccountBalanceState,
  ActivityEntry,
  AuditDisclosure,
  AuditorKeyGeneration,
  NetworkStatus,
  Role,
} from "@/lib/types";
import { hydrateMintAndPersonas, RECEIVER, SENDER } from "@/lib/entities";
import * as backend from "@/lib/backend/client";
import { Locale } from "@/lib/i18n";
import { setActiveLocale } from "@/lib/locale";

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
  confidentialTransfer: (fromId: string, toId: string, amount: number) => Promise<ActivityEntry>;
  applyPending: (accountId: string) => Promise<void>;

  requestAuditDisclosure: (
    activityId: string,
    requestedBy: string,
    reason: string,
    useKeyGenerationId: string
  ) => Promise<AuditDisclosure>;
  rotateAuditorKey: (confirmPassword: string) => Promise<AuditorKeyGeneration>;
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
export function redactForTokens(
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

function activeAuditorKeyGeneration(gens: AuditorKeyGeneration[]): AuditorKeyGeneration {
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
  setLanguage: (language) => {
    setActiveLocale(language);
    set({ language });
  },

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

  confidentialTransfer: async (fromId, toId, amount) => {
    const { signature, state } = await backend.confidentialTransfer(
      fromId,
      toId,
      amount,
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
}));

// Every backend request reports success/failure here. Once the initial
// connection has succeeded, a later failure means devnet or the backend
// hiccuped, not that we're disconnected — "degraded", not "disconnected".
backend.onNetworkStatus((ok) => {
  if (!useDemoStore.getState().backendReady) return;
  useDemoStore.setState({ network: ok ? "connected" : "degraded" });
});
