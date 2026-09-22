import { create } from "zustand";
import {
  AccountBalanceState,
  ActivityEntry,
  AuditDisclosure,
  AuditorKeyGeneration,
  NetworkStatus,
} from "@/lib/types";
import { hydrateMintAndPersonas, RECEIVER, SENDER } from "@/lib/entities";
import * as backend from "@/lib/backend/client";
import { Locale } from "@/lib/i18n";
import { setActiveLocale } from "@/lib/locale";

interface DemoState {
  ownerAccountId: string;
  network: NetworkStatus;
  language: Locale;
  connectedWalletAddress: string;
  totalSupply: number;
  balances: Record<string, AccountBalanceState>;
  activity: ActivityEntry[];
  auditorKeyGenerations: AuditorKeyGeneration[];
  auditDisclosures: AuditDisclosure[];

  // Which roles the viewer has switched on. Memory-only, so a reload always
  // starts as a public observer. Sent to the backend on every request; it
  // redacts confidential fields and disclosure records for whatever is off
  // (see rust-service/src/auth.rs). A demo switch, not a credential.
  viewRoles: backend.ViewRoles;

  backendReady: boolean;
  backendError: string | null;

  setOwnerAccountId: (id: string) => void;
  setNetwork: (status: NetworkStatus) => void;
  setLanguage: (language: Locale) => void;
  hydrate: () => Promise<void>;
  reset: () => Promise<void>;

  setViewRole: (role: backend.ViewRole, on: boolean) => Promise<void>;

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
  rotateAuditorKey: () => Promise<AuditorKeyGeneration>;
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

// Switching a role off (or the "Refresh from devnet" reset) takes effect
// immediately — but without this, the previously-decrypted balances/amounts
// already sitting in the store stay exactly as they were until the
// background `hydrate()` finishes its real devnet round trip (a confirmed
// ~1-3s gap): the UI would show the public view right next to a
// still-visible decrypted figure from a moment ago. This redacts client-side
// state to match `roles` in the same tick the switch flips, so there's no
// window where they disagree; `hydrate()` then reconfirms it for real.
export function redactForRoles(
  balances: Record<string, AccountBalanceState>,
  activity: ActivityEntry[],
  roles: backend.ViewRoles
): { balances: Record<string, AccountBalanceState>; activity: ActivityEntry[] } {
  const holds = (accountId: string) =>
    (accountId === "sender" && roles.sender) || (accountId === "receiver" && roles.receiver);

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
            disclosedAmount: roles.auditor ? a.confidential.disclosedAmount : undefined,
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
  ownerAccountId: SENDER.id,
  network: "connected",
  language: "en",
  connectedWalletAddress: SENDER.address,
  totalSupply: 0,
  balances: {},
  activity: [],
  auditorKeyGenerations: [],
  auditDisclosures: [],
  viewRoles: backend.NO_ROLES,
  backendReady: false,
  backendError: null,

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
      const state = await backend.fetchState(get().viewRoles);
      set({ ...applyBackendState(state), backendReady: true, backendError: null });
    } catch (e) {
      set({ backendReady: false, backendError: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  },

  reset: async () => {
    set((s) => ({
      ownerAccountId: SENDER.id,
      network: "connected",
      connectedWalletAddress: SENDER.address,
      viewRoles: backend.NO_ROLES,
      ...redactForRoles(s.balances, s.activity, backend.NO_ROLES),
    }));
    await get().hydrate();
  },

  setViewRole: async (role, on) => {
    const roles = { ...get().viewRoles, [role]: on };
    if (on) {
      // Fetch the newly visible state *before* flipping the switch, so the UI
      // never shows the owner/auditor view for the moment before the
      // now-visible data has actually arrived (two real devnet RPC reads
      // happen inside /state) — switch and data land in one render.
      const state = await backend.fetchState(roles);
      set({ viewRoles: roles, ...applyBackendState(state), backendReady: true, backendError: null });
    } else {
      set((s) => ({ viewRoles: roles, ...redactForRoles(s.balances, s.activity, roles) }));
      await get().hydrate().catch(() => {
        // surfaced via backendError already; switching a view off shouldn't throw further
      });
    }
  },

  mintSupply: async (accountId, amount) => {
    const { signature, state } = await backend.mintSupply(accountId, amount, get().viewRoles);
    set(applyBackendState(state));
    const entry = state.activity.find((a) => a.signature === signature);
    if (!entry) throw new Error("mint succeeded but activity entry was not found");
    return entry;
  },

  deposit: async (accountId, amount) => {
    const { signature, state } = await backend.deposit(accountId, amount, get().viewRoles);
    set(applyBackendState(state));
    const entry = state.activity.find((a) => a.signature === signature);
    if (!entry) throw new Error("deposit succeeded but activity entry was not found");
    return entry;
  },

  withdraw: async (accountId, amount) => {
    const { signature, state } = await backend.withdraw(accountId, amount, get().viewRoles);
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
      get().viewRoles
    );
    set(applyBackendState(state));
    const entry = state.activity.find((a) => a.signature === signature);
    if (!entry) throw new Error("transfer succeeded but activity entry was not found");
    return entry;
  },

  applyPending: async (accountId) => {
    const { state } = await backend.applyPending(accountId, get().viewRoles);
    set(applyBackendState(state));
  },

  requestAuditDisclosure: async (activityId, requestedBy, reason, useKeyGenerationId) => {
    const { disclosure, state } = await backend.requestAuditDisclosure(
      activityId,
      requestedBy,
      reason,
      useKeyGenerationId,
      get().viewRoles
    );
    set(applyBackendState(state));
    return disclosure;
  },

  rotateAuditorKey: async () => {
    const state = await backend.rotateAuditorKey(get().viewRoles);
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
