import { AgentProposal, DecisionRecord, Mint, Persona } from "./types";

// Real, publicly-documented program ids.
export const TOKEN_2022_PROGRAM_ID =
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const ZK_ELGAMAL_PROOF_PROGRAM_ID =
  "ZkE1Gama1Proof11111111111111111111111111111";

// MINT/SENDER/RECEIVER start as placeholders and are overwritten in place
// (same object identity, mutated fields) once the devnet backend's real
// mint/account addresses are fetched — see store/demo-store.ts's `hydrate`
// action. Every existing import of these objects across the app therefore
// sees real devnet data after the first successful fetch, without needing to
// thread a loading value through every consumer.
export const MINT: Mint = {
  address: "",
  name: "Token-X",
  symbol: "TOKEN-X",
  decimals: 2,
  programId: TOKEN_2022_PROGRAM_ID,
  zkProofProgramId: ZK_ELGAMAL_PROOF_PROGRAM_ID,
  confidentialTransferAuthority: "",
  extensions: ["ConfidentialTransferMint"],
  autoApproveNewAccounts: true,
  cluster: "devnet",
};

export const SENDER: Persona = {
  id: "sender",
  name: "Lotus Textiles HK",
  initials: "LT",
  address: "",
  tokenAccount: "",
  role: "sender",
};

export const RECEIVER: Persona = {
  id: "receiver",
  name: "Harbour Logistics Ltd",
  initials: "HL",
  address: "",
  tokenAccount: "",
  role: "receiver",
};

export const PERSONAS: Persona[] = [SENDER, RECEIVER];

export function hydrateMintAndPersonas(
  mint: Mint,
  personas: Record<string, { address: string; tokenAccount: string }>
) {
  Object.assign(MINT, mint);
  if (personas[SENDER.id]) Object.assign(SENDER, personas[SENDER.id]);
  if (personas[RECEIVER.id]) Object.assign(RECEIVER, personas[RECEIVER.id]);
}

export const AGENT_PROPOSALS: AgentProposal[] = [];
export const DECISION_RECORDS: DecisionRecord[] = [];

export function findPersona(id: string): Persona | undefined {
  return PERSONAS.find((p) => p.id === id);
}
