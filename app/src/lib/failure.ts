import { FailureStage } from "./types";

// Classifies a real error message (thrown by the backend client) into the
// pipeline stage it most likely failed at, so the UI can say "Failed at:
// <stage>" per UX-08 — without ever fabricating what actually happened. The
// stage drives which pipeline step lights up as failed; the caller should
// still show the real message as the detail text.
export function classifyFailure(message: string): FailureStage {
  const m = message.toLowerCase();
  if (m.includes("insufficient")) return "proof_generation";
  if (m.includes("blockhash") || m.includes("preflight") || m.includes("simulation")) return "submission";
  if (m.includes("timed out") || m.includes("timeout")) return "confirmation";
  if (m.includes("could not reach") || m.includes("fetch")) return "submission";
  return "submission";
}
