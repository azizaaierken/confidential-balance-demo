import { describe, expect, it } from "vitest";
import { expandEvidenceSteps } from "./evidence-steps";
import { EvidenceStep } from "@/lib/types";

describe("expandEvidenceSteps", () => {
  it("itemises a single V1 transfer into its instructions, in on-chain order", () => {
    const steps: EvidenceStep[] = [{ label: "submit_transfer_v1", signature: "sig" }];
    expect(expandEvidenceSteps(steps, "transfer").map((s) => s.label)).toEqual([
      "verify_equality_proof",
      "verify_validity_proof",
      "verify_range_proof",
      "submit_transfer_v1",
    ]);
    expect(new Set(expandEvidenceSteps(steps, "transfer").map((s) => s.signature))).toEqual(
      new Set(["sig"])
    );
  });

  it("itemises a single V1 withdraw with the withdraw instruction first", () => {
    const steps: EvidenceStep[] = [{ label: "submit_withdraw_v1", signature: "sig" }];
    expect(expandEvidenceSteps(steps, "withdraw").map((s) => s.label)).toEqual([
      "submit_withdraw_v1",
      "verify_equality_proof",
      "verify_range_proof",
    ]);
  });

  it("leaves multi-transaction (legacy) entries and mismatched kinds alone", () => {
    const legacy: EvidenceStep[] = [
      { label: "verify_equality_proof", signature: "a" },
      { label: "submit_transfer", signature: "b" },
    ];
    expect(expandEvidenceSteps(legacy, "transfer")).toBe(legacy);
    const withdraw: EvidenceStep[] = [{ label: "submit_withdraw_v1", signature: "sig" }];
    expect(expandEvidenceSteps(withdraw, "transfer")).toBe(withdraw);
  });
});
