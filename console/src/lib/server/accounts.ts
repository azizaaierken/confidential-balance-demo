/**
 * On-chain account reads: the associated token accounts, the mint, and the
 * decrypted balance view of a persona's account.
 *
 * The server holds every persona's keypair, so it can always decrypt both
 * confidential balances. Who gets to *see* the plaintext is decided per
 * request in `state.ts` from the caller's roles — this module just reads and
 * decrypts. Decryption failure is an error, never a zero: a wrong derivation
 * or a corrupt key must surface as such rather than render as an empty
 * balance.
 */
import {
	fetchEncodedAccounts,
	getBase58Decoder,
	isSome,
	type Address,
	type KeyPairSigner,
	type ReadonlyUint8Array
} from '@solana/kit';
import {
	TOKEN_2022_PROGRAM_ADDRESS,
	decodeMint,
	decodeToken,
	findAssociatedTokenPda,
	type Extension,
	type Mint,
	type Token
} from '@solana-program/token-2022';
import { AeCiphertext, ElGamalCiphertext, type ElGamalSecretKey } from '@solana/zk-sdk';
import { deriveAccountKeys } from './keys';
import { withRpcRetry, type SolanaRpc } from './rpc';

export const ZK_PROOF_PROGRAM_ID = 'ZkE1Gama1Proof11111111111111111111111111111';
export const INSTRUCTIONS_SYSVAR = 'Sysvar1nstructions1111111111111111111111111' as Address;

export async function ataFor(owner: Address, mint: Address): Promise<Address> {
	const [ata] = await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS });
	return ata;
}

export type ConfidentialTransferAccountExt = Extract<Extension, { __kind: 'ConfidentialTransferAccount' }>;
export type ConfidentialTransferMintExt = Extract<Extension, { __kind: 'ConfidentialTransferMint' }>;

export function confidentialAccountExt(token: Token): ConfidentialTransferAccountExt | null {
	if (!isSome(token.extensions)) return null;
	return (
		(token.extensions.value.find((e) => e.__kind === 'ConfidentialTransferAccount') as
			| ConfidentialTransferAccountExt
			| undefined) ?? null
	);
}

export function requireConfidentialAccountExt(token: Token, what: string): ConfidentialTransferAccountExt {
	const ext = confidentialAccountExt(token);
	if (!ext) throw new Error(`${what} is not configured for confidential transfers`);
	return ext;
}

export function confidentialMintExt(mint: Mint): ConfidentialTransferMintExt {
	if (!isSome(mint.extensions)) throw new Error('mint has no extensions');
	const ext = mint.extensions.value.find((e) => e.__kind === 'ConfidentialTransferMint');
	if (!ext) throw new Error('mint is missing the ConfidentialTransferMint extension');
	return ext as ConfidentialTransferMintExt;
}

/** Fetch several accounts in one round trip; `null` where an account is missing. */
export async function fetchAccounts(rpc: SolanaRpc, addresses: Address[]) {
	return withRpcRetry('getMultipleAccounts', () =>
		fetchEncodedAccounts(rpc, addresses, { commitment: 'confirmed' })
	);
}

export async function fetchTokenOrNull(rpc: SolanaRpc, address: Address): Promise<Token | null> {
	const [acc] = await fetchAccounts(rpc, [address]);
	if (!acc.exists) return null;
	return decodeToken(acc).data;
}

export async function fetchTokenRequired(rpc: SolanaRpc, address: Address, what: string): Promise<Token> {
	const token = await fetchTokenOrNull(rpc, address);
	if (!token) throw new Error(`${what} ${address} does not exist on chain`);
	return token;
}

export async function fetchMintOrNull(rpc: SolanaRpc, address: Address): Promise<Mint | null> {
	const [acc] = await fetchAccounts(rpc, [address]);
	if (!acc.exists) return null;
	return decodeMint(acc).data;
}

export async function fetchMintRequired(rpc: SolanaRpc, address: Address): Promise<Mint> {
	const mint = await fetchMintOrNull(rpc, address);
	if (!mint) throw new Error(`mint ${address} not found on chain`);
	return mint;
}

export function parseElGamalCiphertext(bytes: ReadonlyUint8Array, what: string): ElGamalCiphertext {
	const ct = ElGamalCiphertext.fromBytes(new Uint8Array(bytes));
	if (!ct) throw new Error(`decode ${what}: not a valid ElGamal ciphertext`);
	return ct;
}

export function parseAeCiphertext(bytes: ReadonlyUint8Array, what: string): AeCiphertext {
	const ct = AeCiphertext.fromBytes(new Uint8Array(bytes));
	if (!ct) throw new Error(`decode ${what}: not a valid AES ciphertext`);
	return ct;
}

/** The zk-sdk throws on a failed discrete-log search; normalise to `null`. */
export function tryDecrypt(secret: ElGamalSecretKey, ct: ElGamalCiphertext): bigint | null {
	try {
		const v = secret.decrypt(ct);
		return v === undefined ? null : v;
	} catch {
		return null;
	}
}

export const PENDING_BALANCE_LO_BITS = 16n;

// ---------------------------------------------------------------------------
// Balance view
// ---------------------------------------------------------------------------

export type AccountView = {
	public: bigint;
	pending: bigint;
	available: bigint;
	/** Short hex fingerprint of the real on-chain ciphertext — display only. */
	availableCiphertextFingerprint: string;
	pendingCiphertextFingerprint: string;
};

export const EMPTY_VIEW: AccountView = {
	public: 0n,
	pending: 0n,
	available: 0n,
	availableCiphertextFingerprint: '',
	pendingCiphertextFingerprint: ''
};

export function fingerprint(bytes: ReadonlyUint8Array): string {
	const hex = toHex(bytes);
	return hex.length <= 16 ? `0x${hex}` : `0x${hex.slice(0, 8)}…${hex.slice(-6)}`;
}

export function toHex(bytes: ReadonlyUint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex: string): Uint8Array {
	if (hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) throw new Error('invalid hex');
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	return out;
}

/**
 * Memo of pending-balance ciphertexts already decrypted. Recovering a pending
 * balance is a discrete-log search over an ElGamal ciphertext, and every
 * state read needs two per account. The ciphertext only changes when the
 * pending balance does, so keying by the ciphertext bytes makes repeat reads
 * (view switches, post-action refreshes) free.
 */
export class DecryptCache {
	private map = new Map<string, bigint>();
	decrypt(bytes: ReadonlyUint8Array, secret: ElGamalSecretKey, what: string): bigint {
		const key = toHex(bytes);
		const hit = this.map.get(key);
		if (hit !== undefined) return hit;
		const v = tryDecrypt(secret, parseElGamalCiphertext(bytes, what));
		if (v === null) throw new Error(`decrypt ${what}: ${KDF_HINT}`);
		this.map.set(key, v);
		return v;
	}
}

const KDF_HINT =
	'the key derived from the owner’s signature does not decrypt this account; ' +
	'the account was configured under different key material than this .env holds';

export const decryptCache = new DecryptCache();

/** Decrypt an already-fetched token account. */
export async function decodeAccountView(
	token: Token,
	owner: KeyPairSigner,
	tokenAccount: Address,
	cache: DecryptCache = decryptCache
): Promise<AccountView> {
	const ext = confidentialAccountExt(token);
	if (!ext) return { ...EMPTY_VIEW, public: token.amount };

	const { elgamal, aes } = await deriveAccountKeys(owner, tokenAccount);
	// Pending balance is only ever ElGamal-encrypted (deposits and incoming
	// transfers are added homomorphically by the program, which has no AES
	// key), so it is recovered by discrete-log search on the two halves.
	// Available balance additionally carries an AES ciphertext the owner wrote
	// for exactly this purpose, so read that.
	const pendingLo = cache.decrypt(ext.pendingBalanceLow, elgamal.secret(), `pending_balance_lo of ${tokenAccount}`);
	const pendingHi = cache.decrypt(ext.pendingBalanceHigh, elgamal.secret(), `pending_balance_hi of ${tokenAccount}`);
	const available = aes.decrypt(
		parseAeCiphertext(ext.decryptableAvailableBalance, 'decryptable_available_balance')
	);
	if (available === undefined || available === null) {
		throw new Error(`decrypt decryptable_available_balance of ${tokenAccount}: ${KDF_HINT}`);
	}
	return {
		public: token.amount,
		pending: pendingLo + (pendingHi << PENDING_BALANCE_LO_BITS),
		available,
		availableCiphertextFingerprint: fingerprint(ext.availableBalance),
		pendingCiphertextFingerprint: fingerprint(ext.pendingBalanceLow)
	};
}

export async function readAccountView(rpc: SolanaRpc, mint: Address, owner: KeyPairSigner): Promise<AccountView> {
	const ata = await ataFor(owner.address, mint);
	const token = await fetchTokenOrNull(rpc, ata);
	if (!token) return EMPTY_VIEW;
	return decodeAccountView(token, owner, ata);
}

export function base58(bytes: ReadonlyUint8Array): string {
	return getBase58Decoder().decode(bytes);
}
