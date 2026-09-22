import { afterEach, describe, expect, it, vi } from "vitest";
import * as backend from "@/lib/backend/client";
import { useDemoStore } from "./demo-store";

const emptyState: backend.BackendState = {
  mint: {
    address: "m",
    name: "Token-X",
    symbol: "TOKEN-X",
    decimals: 2,
    programId: "p",
    zkProofProgramId: "z",
    confidentialTransferAuthority: "a",
    feePayer: "f",
    extensions: [],
    autoApproveNewAccounts: true,
    cluster: "devnet",
  },
  totalSupply: 0,
  balances: {},
  personas: {},
  auditorKeyGenerations: [],
  activity: [],
  auditDisclosures: [],
};

afterEach(() => {
  vi.restoreAllMocks();
  useDemoStore.setState({ backendReady: false, backendError: null, network: "connected" });
});

describe("refresh failures", () => {
  it("the first connection failing shows the error screen", async () => {
    vi.spyOn(backend, "fetchState").mockRejectedValue(new Error("boom"));
    await expect(useDemoStore.getState().hydrate()).rejects.toThrow("boom");
    expect(useDemoStore.getState().backendReady).toBe(false);
    expect(useDemoStore.getState().backendError).toBe("boom");
  });

  it("a refresh failing after a successful load only degrades the connection", async () => {
    vi.spyOn(backend, "fetchState").mockResolvedValueOnce(emptyState);
    await useDemoStore.getState().hydrate();
    expect(useDemoStore.getState().backendReady).toBe(true);

    vi.spyOn(backend, "fetchState").mockRejectedValueOnce(new Error("devnet hiccup"));
    await expect(useDemoStore.getState().hydrate()).rejects.toThrow("devnet hiccup");
    expect(useDemoStore.getState().backendReady).toBe(true);
    expect(useDemoStore.getState().backendError).toBeNull();
    expect(useDemoStore.getState().network).toBe("degraded");
  });

  it("switching a view on keeps the switch and degrades when the read fails", async () => {
    vi.spyOn(backend, "fetchState").mockResolvedValueOnce(emptyState);
    await useDemoStore.getState().hydrate();

    vi.spyOn(backend, "fetchState").mockRejectedValueOnce(new Error("devnet hiccup"));
    await useDemoStore.getState().setViewRole("auditor", true);
    expect(useDemoStore.getState().viewRoles.auditor).toBe(true);
    expect(useDemoStore.getState().backendError).toBeNull();
    expect(useDemoStore.getState().network).toBe("degraded");
  });

  it("an older read landing after a newer one is ignored", async () => {
    let resolveOld!: (s: backend.BackendState) => void;
    const old = new Promise<backend.BackendState>((r) => (resolveOld = r));
    const spy = vi.spyOn(backend, "fetchState");
    spy.mockReturnValueOnce(old);
    const oldRead = useDemoStore.getState().hydrate();

    spy.mockResolvedValueOnce({ ...emptyState, totalSupply: 42 });
    await useDemoStore.getState().hydrate();
    expect(useDemoStore.getState().totalSupply).toBe(42);

    resolveOld({ ...emptyState, totalSupply: 1 });
    await oldRead;
    expect(useDemoStore.getState().totalSupply).toBe(42);
  });
});
