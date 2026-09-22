/**
 * Per-transfer auditor disclosure and auditor-key generations.
 *
 * Disclosure decrypts a captured auditor ciphertext (hex lo/hi halves,
 * produced by `transfer.ts`) using one generation's ElGamal secret. The
 * captured bytes are the auditor's single-handle ElGamal ciphertext
 * (commitment || auditor handle), so they decrypt directly. Decryption with
 * the wrong generation fails safely (returns null) — the discrete-log search
 * finds no match — which is what makes "wrong generation fails safely" hold
 * with no special-case check.
 *
 * Generations are derived deterministically from the auditor root key (see
 * `keys.ts`), so the "active" generation is not a stored counter: it is
 * resolved from the auditor pubkey the mint currently points at. That keeps
 * the on-chain state authoritative and survives a fresh container.
 */
import type { Address, KeyPairSigner } from '@solana/kit';
import type { ElGamalKeypair } from '@solana/zk-sdk';
import { fromHex, parseElGamalCiphertext, tryDecrypt } from '../accounts';
import { deriveAuditorGeneration, elgamalPubkeyToAddress } from '../keys';

const LO_BITS = 16n;

/** How far to scan when matching the on-chain auditor key to a generation. */
export const MAX_GENERATIONS = 256;

export function decryptAuditorAmount(loHex: string, hiHex: string, auditor: ElGamalKeypair): bigint | null {
	const lo = fromHex(loHex);
	const hi = fromHex(hiHex);
	if (lo.length !== 64 || hi.length !== 64) throw new Error('auditor ciphertext halves must be 64 bytes each');
	let loCt, hiCt;
	try {
		loCt = parseElGamalCiphertext(lo, 'auditor lo');
		hiCt = parseElGamalCiphertext(hi, 'auditor hi');
	} catch {
		return null;
	}
	const loAmount = tryDecrypt(auditor.secret(), loCt);
	const hiAmount = tryDecrypt(auditor.secret(), hiCt);
	if (loAmount === null || hiAmount === null) return null;
	return loAmount + (hiAmount << LO_BITS);
}

export function generationId(generation: number): string {
	return `auditor-key-gen-${generation}`;
}

export function generationLabel(generation: number): string {
	return `Auditor Key — Generation ${generation}`;
}

export type ResolvedGeneration = { generation: number; elgamal: ElGamalKeypair; pubkey: Address };

/**
 * Find which generation the mint's current auditor pubkey belongs to by
 * deriving generations from the root until one matches. Returns null if the
 * on-chain key was not derived from this root at all.
 */
export async function resolveActiveGeneration(
	root: KeyPairSigner,
	mint: Address,
	onChainAuditor: Address | null,
	hint = 1
): Promise<ResolvedGeneration | null> {
	if (!onChainAuditor) return null;
	// Try the hinted generation first (cheap when the registry already knows).
	const order = [hint, ...Array.from({ length: MAX_GENERATIONS }, (_, i) => i + 1).filter((g) => g !== hint)];
	for (const generation of order) {
		const elgamal = await deriveAuditorGeneration(root, mint, generation);
		const pubkey = elgamalPubkeyToAddress(elgamal);
		if (pubkey === onChainAuditor) return { generation, elgamal, pubkey };
	}
	return null;
}
