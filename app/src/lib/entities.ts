import { Mint, Persona } from "./types";

// Real, publicly-documented program ids.
export const TOKEN_2022_PROGRAM_ID =
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const ZK_ELGAMAL_PROOF_PROGRAM_ID =
  "ZkE1Gama1Proof11111111111111111111111111111";

// The demo's fixed cast: one mint and two personas. Names and roles are
// static; addresses start empty and are filled in place (same object
// identity, mutated fields) from the backend's real devnet state on the
// first successful fetch — see store/demo-store.ts's `hydrate`. Every import
// of these objects therefore sees real addresses after that fetch without
// threading a loading value through every consumer.
export const MINT: Mint = {
  address: "",
  name: "Token-X",
  symbol: "TOKEN-X",
  decimals: 2,
  programId: TOKEN_2022_PROGRAM_ID,
  zkProofProgramId: ZK_ELGAMAL_PROOF_PROGRAM_ID,
  confidentialTransferAuthority: "",
  feePayer: "",
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

export function findPersona(id: string): Persona | undefined {
  return PERSONAS.find((p) => p.id === id);
}
