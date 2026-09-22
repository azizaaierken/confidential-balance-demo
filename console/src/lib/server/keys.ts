/**
 * Keypair loading and confidential-key derivation.
 *
 * Every signer this demo uses (payer, mint authority, the two personas and
 * the auditor root) is a plain Ed25519 keypair held in the process
 * environment (`console/.env` locally, Secret Manager on the platform) as
 * base58 of the 64-byte `seed || pubkey` form the Solana CLI writes. Cloud
 * Run has no persistent disk, so nothing is ever written at runtime.
 *
 * The ElGamal and AES keys that actually encrypt confidential balances are
 * not stored anywhere: they are re-derived on every use from the owner's
 * Ed25519 signature over `solana-conf-bal/v1 || seed` (the token account
 * address for a persona, `mint || generation` for the auditor) with the
 * zk-sdk's HKDF-SHA512 scheme. This is the one place that derivation
 * happens, so every module agrees on the scheme.
 */
import {
	createKeyPairSignerFromBytes,
	generateKeyPairSigner,
	getAddressEncoder,
	getBase58Decoder,
	getBase58Encoder,
	signBytes,
	type Address,
	type KeyPairSigner
} from '@solana/kit';
import { AeKey, ConfidentialKeys, ElGamalKeypair } from '@solana/zk-sdk';
import { ENV, requireEnv } from './config';

export type AccountKeys = { elgamal: ElGamalKeypair; aes: AeKey };

// ---------------------------------------------------------------------------
// Keypair (de)serialisation
// ---------------------------------------------------------------------------

/** Parse a base58 64-byte keypair into a Kit signer. */
export async function signerFromBase58(encoded: string): Promise<KeyPairSigner> {
	const bytes = getBase58Encoder().encode(encoded.trim());
	if (bytes.length !== 64) {
		throw new Error(`keypair must be 64 bytes (seed || pubkey), got ${bytes.length}`);
	}
	// Loaded keys only ever sign; only freshly generated ones need exporting.
	return createKeyPairSignerFromBytes(bytes, false);
}

/** Generate a fresh keypair and return the signer plus its base58 64-byte form. */
export async function generateKeypairBase58(): Promise<{ signer: KeyPairSigner; encoded: string }> {
	const signer = await generateKeyPairSigner(true);
	const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', signer.keyPair.privateKey));
	// PKCS#8 Ed25519: 16-byte header, then the 32-byte seed.
	const seed = pkcs8.slice(pkcs8.length - 32);
	const pub = new Uint8Array(getAddressEncoder().encode(signer.address));
	const full = new Uint8Array(64);
	full.set(seed, 0);
	full.set(pub, 32);
	return { signer, encoded: getBase58Decoder().decode(full) };
}

export function loadSigner(envName: string): Promise<KeyPairSigner> {
	return signerFromBase58(requireEnv(envName));
}

export type DemoSigners = {
	payer: KeyPairSigner;
	mintAuthority: KeyPairSigner;
	sender: KeyPairSigner;
	receiver: KeyPairSigner;
	auditorRoot: KeyPairSigner;
	mint: Address;
};

export async function loadDemoSigners(): Promise<DemoSigners> {
	const [payer, mintAuthority, sender, receiver, auditorRoot] = await Promise.all([
		loadSigner(ENV.PAYER),
		loadSigner(ENV.MINT_AUTHORITY),
		loadSigner(ENV.SENDER),
		loadSigner(ENV.RECEIVER),
		loadSigner(ENV.AUDITOR_ROOT)
	]);
	return { payer, mintAuthority, sender, receiver, auditorRoot, mint: requireEnv(ENV.MINT_ADDRESS) as Address };
}

// ---------------------------------------------------------------------------
// Confidential key derivation
// ---------------------------------------------------------------------------

async function deriveWithSeed(signer: KeyPairSigner, seed: Uint8Array): Promise<ConfidentialKeys> {
	const message = ConfidentialKeys.signerMessageWithSeed(seed);
	// WebCrypto Ed25519 is RFC 8032 deterministic, so the same signer and seed
	// always yield the same signature and therefore the same keys.
	const signature = await signBytes(signer.keyPair.privateKey, message);
	return ConfidentialKeys.fromSignature(new Uint8Array(signature));
}

/**
 * Derive the ElGamal keypair and AES key that encrypt `tokenAccount`'s
 * confidential balances, from its owner's signature.
 */
export async function deriveAccountKeys(owner: KeyPairSigner, tokenAccount: Address): Promise<AccountKeys> {
	const keys = await deriveWithSeed(owner, new Uint8Array(getAddressEncoder().encode(tokenAccount)));
	return { elgamal: keys.elgamal(), aes: keys.ae() };
}

/** `mint || generation (u32 LE)`: the public seed for auditor generation N. */
export function auditorGenerationSeed(mint: Address, generation: number): Uint8Array {
	if (!Number.isInteger(generation) || generation < 1 || generation > 0xffff_ffff) {
		throw new Error(`invalid auditor generation ${generation}`);
	}
	const seed = new Uint8Array(36);
	seed.set(getAddressEncoder().encode(mint), 0);
	new DataView(seed.buffer).setUint32(32, generation, true);
	return seed;
}

/**
 * Derive auditor generation N's ElGamal keypair from the single auditor root
 * key. Only the ElGamal half is used: the auditor never holds an
 * AES-encrypted balance of its own. Generations are pure functions of
 * (root, mint, N), so rotation needs no new key material anywhere.
 */
export async function deriveAuditorGeneration(
	root: KeyPairSigner,
	mint: Address,
	generation: number
): Promise<ElGamalKeypair> {
	return (await deriveWithSeed(root, auditorGenerationSeed(mint, generation))).elgamal();
}

/** An ElGamal pubkey as the base58 string the token-2022 client uses for it. */
export function elgamalPubkeyToAddress(keypair: ElGamalKeypair): Address {
	return getBase58Decoder().decode(keypair.pubkey().toBytes()) as Address;
}
