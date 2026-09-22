import { describe, expect, it } from "vitest";
import { canSeeAccountConfidentialBalance, canSeeConfidentialAmount } from "./permissions";
import { ActivityEntry } from "./types";

const entry: ActivityEntry = {
  id: "a",
  type: "confidential_transfer",
  fromAccountId: "sender",
  toAccountId: "receiver",
  status: "confirmed",
  privacy: "confidential",
  timestamp: 0,
  signature: "s",
  programActivity: [],
  steps: [],
};

describe("view permissions", () => {
  it("a public observer never sees a confidential amount or balance", () => {
    expect(canSeeConfidentialAmount(entry, "public", "sender")).toBe(false);
    expect(canSeeAccountConfidentialBalance("sender", "public", "sender")).toBe(false);
  });

  it("an owner sees amounts only for transfers they are party to", () => {
    expect(canSeeConfidentialAmount(entry, "owner", "sender")).toBe(true);
    expect(canSeeConfidentialAmount(entry, "owner", "receiver")).toBe(true);
    expect(canSeeConfidentialAmount(entry, "owner", "someone-else")).toBe(false);
  });

  it("an owner sees only their own account's confidential balance", () => {
    expect(canSeeAccountConfidentialBalance("sender", "owner", "sender")).toBe(true);
    expect(canSeeAccountConfidentialBalance("receiver", "owner", "sender")).toBe(false);
  });

  it("the auditor lens does not grant party visibility", () => {
    expect(canSeeConfidentialAmount(entry, "auditor", "sender")).toBe(false);
  });
});
