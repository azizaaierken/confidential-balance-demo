import type { FailureStage } from "./types";

// Classifies a real error message (thrown by the backend client) into the
// stage it most likely failed at, so the UI can say "Failed at: <stage>"
// without fabricating what happened. The stage drives which pipeline step
// lights up as failed; the caller should still show the real message as the
// detail text.
export function classifyFailure(message: string): FailureStage {
  const m = message.toLowerCase();
  if (m.includes("insufficient") || m.includes("proof")) return "proof_generation";
  if (m.includes("timed out") || m.includes("timeout")) return "confirmation";
  return "submission";
}
