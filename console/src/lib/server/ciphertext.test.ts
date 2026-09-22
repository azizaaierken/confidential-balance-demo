import { describe, expect, it } from 'vitest';
import { ElGamalKeypair, ElGamalPubkey, GroupedElGamalCiphertext3Handles, PedersenOpening } from '@solana/zk-sdk';
import {
	extractCiphertextFromGroupedBytes,
	subtractAmountFromCiphertext,
	subtractWithLoHiCiphertexts
} from './ciphertext';
import { parseElGamalCiphertext, tryDecrypt } from './accounts';

describe('ciphertext arithmetic', () => {
	it('subtracting lo/hi halves yields a ciphertext of the remaining balance', () => {
		const owner = new ElGamalKeypair();
		const dest = new ElGamalKeypair();
		const auditor = new ElGamalKeypair();
		const balance = owner.pubkey().encryptU64(100_000n);
		const amount = 70_001n; // lo = 70_001 & 0xffff = 4465, hi = 1
		const lo = amount & 0xffffn;
		const hi = amount >> 16n;
		const gLo = GroupedElGamalCiphertext3Handles.encryptWith(owner.pubkey(), dest.pubkey(), auditor.pubkey(), lo, new PedersenOpening());
		const gHi = GroupedElGamalCiphertext3Handles.encryptWith(owner.pubkey(), dest.pubkey(), auditor.pubkey(), hi, new PedersenOpening());
		const srcLo = extractCiphertextFromGroupedBytes(gLo.toBytes(), 0);
		const srcHi = extractCiphertextFromGroupedBytes(gHi.toBytes(), 0);
		const remaining = subtractWithLoHiCiphertexts(balance.toBytes(), srcLo, srcHi, 16n);
		expect(tryDecrypt(owner.secret(), parseElGamalCiphertext(remaining, 'remaining'))).toBe(100_000n - amount);

		// The auditor handle decrypts the same amount under the auditor key.
		const audLo = extractCiphertextFromGroupedBytes(gLo.toBytes(), 2);
		expect(tryDecrypt(auditor.secret(), parseElGamalCiphertext(audLo, 'aud'))).toBe(lo);
	});

	it('subtracting a plaintext amount from a ciphertext', () => {
		const owner = new ElGamalKeypair();
		const ct = owner.pubkey().encryptU64(500n);
		const out = subtractAmountFromCiphertext(ct.toBytes(), 120n);
		expect(tryDecrypt(owner.secret(), parseElGamalCiphertext(out, 'x'))).toBe(380n);
		expect(ElGamalPubkey.fromBytes(owner.pubkey().toBytes())).toBeDefined();
	});
});
