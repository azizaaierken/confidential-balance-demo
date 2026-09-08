import { ActivityEntry, Role } from "./types";

// Centralizes "who can see what" so no page has to re-derive privacy rules.
// A public observer never sees a confidential amount, full stop — even one an
// auditor has separately disclosed elsewhere in the app (SEC-08 / risk table).

export function canSeeConfidentialAmount(
  entry: ActivityEntry,
  role: Role,
  ownerAccountId: string
): boolean {
  if (role === "public") return false;
  if (role === "owner") {
    return (
      entry.fromAccountId === ownerAccountId || entry.toAccountId === ownerAccountId
    );
  }
  return false;
}

export function canSeeAccountConfidentialBalance(
  accountId: string,
  role: Role,
  ownerAccountId: string
): boolean {
  if (role === "public") return false;
  return accountId === ownerAccountId;
}
