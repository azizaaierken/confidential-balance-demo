import { describe, expect, it } from 'vitest';
import { getBase58Decoder } from '@solana/kit';
import {
	auditorGenerationSeed,
	deriveAccountKeys,
	deriveAuditorGeneration,
	elgamalPubkeyToAddress,
	generateKeypairBase58,
	signerFromBase58
} from './keys';

describe('keypair serialisation', () => {
	it('round-trips through base58', async () => {
		const { signer, encoded } = await generateKeypairBase58();
		const restored = await signerFromBase58(encoded);
		expect(restored.address).toBe(signer.address);
	});

	it('rejects the wrong length', async () => {
		await expect(signerFromBase58(getBase58Decoder().decode(new Uint8Array(32)))).rejects.toThrow(/64 bytes/);
	});
});

describe('confidential key derivation', () => {
	it('is deterministic for a signer and seed', async () => {
		const { signer } = await generateKeypairBase58();
		const { signer: other } = await generateKeypairBase58();
		const a = await deriveAccountKeys(signer, other.address);
		const b = await deriveAccountKeys(signer, other.address);
		expect(elgamalPubkeyToAddress(a.elgamal)).toBe(elgamalPubkeyToAddress(b.elgamal));
		expect(b.aes.decrypt(a.aes.encrypt(4200n))).toBe(4200n);
		expect(a.aes.encrypt(7n).toBytes().length).toBe(36);
	});

	it('gives different keys for different seeds', async () => {
		const { signer } = await generateKeypairBase58();
		const { signer: s1 } = await generateKeypairBase58();
		const { signer: s2 } = await generateKeypairBase58();
		const a = await deriveAccountKeys(signer, s1.address);
		const b = await deriveAccountKeys(signer, s2.address);
		expect(elgamalPubkeyToAddress(a.elgamal)).not.toBe(elgamalPubkeyToAddress(b.elgamal));
	});

	it('auditor generations differ and are reproducible from the root alone', async () => {
		const { signer: root } = await generateKeypairBase58();
		const { signer: mint } = await generateKeypairBase58();
		const g1 = await deriveAuditorGeneration(root, mint.address, 1);
		const g1again = await deriveAuditorGeneration(root, mint.address, 1);
		const g2 = await deriveAuditorGeneration(root, mint.address, 2);
		expect(elgamalPubkeyToAddress(g1)).toBe(elgamalPubkeyToAddress(g1again));
		expect(elgamalPubkeyToAddress(g1)).not.toBe(elgamalPubkeyToAddress(g2));
	});

	it('generation seed is mint || u32 LE', async () => {
		const { signer: mint } = await generateKeypairBase58();
		const seed = auditorGenerationSeed(mint.address, 258);
		expect(seed.length).toBe(36);
		expect(Array.from(seed.slice(32))).toEqual([2, 1, 0, 0]);
		expect(() => auditorGenerationSeed(mint.address, 0)).toThrow();
	});
});
