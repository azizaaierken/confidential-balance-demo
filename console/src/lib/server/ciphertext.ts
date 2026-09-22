/**
 * Homomorphic arithmetic on twisted-ElGamal ciphertext bytes, mirroring the
 * token-2022 client's internal `confidentialTransferArithmetic` (which is not
 * exported). A ciphertext is 64 bytes: a Pedersen commitment then a decrypt
 * handle, both Ristretto points.
 */
import { ristretto255 } from '@noble/curves/ed25519.js';
import type { ReadonlyUint8Array } from '@solana/kit';

const { Point } = ristretto255;
type RPoint = InstanceType<typeof Point>;

function pointFromBytes(bytes: ReadonlyUint8Array): RPoint {
	return Point.fromBytes(new Uint8Array(bytes));
}

function toPoints(ciphertext: ReadonlyUint8Array) {
	if (ciphertext.length !== 64) throw new Error(`expected 64 ciphertext bytes, got ${ciphertext.length}`);
	return { commitment: pointFromBytes(ciphertext.slice(0, 32)), handle: pointFromBytes(ciphertext.slice(32, 64)) };
}

function fromPoints(commitment: RPoint, handle: RPoint): Uint8Array {
	const out = new Uint8Array(64);
	out.set(commitment.toBytes(), 0);
	out.set(handle.toBytes(), 32);
	return out;
}

/**
 * Extract one single-handle ElGamal ciphertext (commitment || handle[i]) from
 * a grouped ciphertext laid out as commitment || handle_0 || handle_1 || ...
 */
export function extractCiphertextFromGroupedBytes(grouped: ReadonlyUint8Array, handleIndex: number): Uint8Array {
	const start = 32 + handleIndex * 32;
	if (grouped.length < start + 32) throw new Error(`grouped ciphertext has no handle ${handleIndex}`);
	const out = new Uint8Array(64);
	out.set(grouped.slice(0, 32), 0);
	out.set(grouped.slice(start, start + 32), 32);
	return out;
}

/** `lo + hi * 2^bitLength` on ciphertexts. */
export function combineLoHiCiphertexts(lo: ReadonlyUint8Array, hi: ReadonlyUint8Array, bitLength: bigint): Uint8Array {
	const scale = 1n << bitLength;
	const l = toPoints(lo);
	const h = toPoints(hi);
	return fromPoints(l.commitment.add(h.commitment.multiply(scale)), l.handle.add(h.handle.multiply(scale)));
}

/** `left - (lo + hi * 2^bitLength)`: the new available balance after a transfer. */
export function subtractWithLoHiCiphertexts(
	left: ReadonlyUint8Array,
	lo: ReadonlyUint8Array,
	hi: ReadonlyUint8Array,
	bitLength: bigint
): Uint8Array {
	const l = toPoints(left);
	const r = toPoints(combineLoHiCiphertexts(lo, hi, bitLength));
	return fromPoints(l.commitment.subtract(r.commitment), l.handle.subtract(r.handle));
}

/** Remove `amount * G` from the commitment: the remaining balance after a withdraw. */
export function subtractAmountFromCiphertext(ciphertext: ReadonlyUint8Array, amount: bigint): Uint8Array {
	const { commitment, handle } = toPoints(ciphertext);
	return amount === 0n ? fromPoints(commitment, handle) : fromPoints(commitment.subtract(Point.BASE.multiply(amount)), handle);
}
