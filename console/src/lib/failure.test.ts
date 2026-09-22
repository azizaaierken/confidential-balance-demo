import { describe, expect, it } from "vitest";
import { classifyFailure } from "./failure";

describe("classifyFailure", () => {
  it("treats an on-chain proof verification failure as a submission failure", () => {
    expect(classifyFailure("transaction failed: ProofVerificationFailed")).toBe("submission");
  });
  it("treats local proof generation and balance problems as proof generation", () => {
    expect(classifyFailure("insufficient available balance")).toBe("proof_generation");
    expect(classifyFailure("range proof could not be built")).toBe("proof_generation");
  });
  it("treats timeouts as confirmation failures", () => {
    expect(classifyFailure("transaction did not confirm: timed out")).toBe("confirmation");
  });
});
