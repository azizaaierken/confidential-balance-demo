/**
 * Configure a persona's token account for confidential transfers: create the
 * ATA if needed, reallocate it for the extension, and configure it with the
 * freshly derived ElGamal key, with the PubkeyValidity proof verified inline
 * in the same legacy transaction (the official helper's single-transaction
 * plan, flattened).
 */
import { getCreateConfidentialTransferAccountInstructionPlan } from '@solana-program/token-2022/confidential';
import type { Address, KeyPairSigner, Signature } from '@solana/kit';
import { ataFor, confidentialAccountExt, fetchTokenOrNull } from '../accounts';
import { deriveAccountKeys } from '../keys';
import { sendAndConfirm, signMessage, type SolanaRpc } from '../rpc';
import { buildLegacyMessage, flattenPlan } from '../tx';

const MAX_PENDING_BALANCE_CREDIT_COUNTER = 65_536;

export async function isConfigured(rpc: SolanaRpc, ata: Address): Promise<boolean> {
	const token = await fetchTokenOrNull(rpc, ata);
	return token !== null && confidentialAccountExt(token) !== null;
}

export async function configureAccount(
	rpc: SolanaRpc,
	payer: KeyPairSigner,
	owner: KeyPairSigner,
	mint: Address
): Promise<Signature> {
	const token = await ataFor(owner.address, mint);
	const { elgamal, aes } = await deriveAccountKeys(owner, token);
	const plan = await getCreateConfidentialTransferAccountInstructionPlan({
		payer,
		owner,
		mint,
		token,
		rpc,
		elgamalKeypair: elgamal,
		aesKey: aes,
		maximumPendingBalanceCreditCounter: MAX_PENDING_BALANCE_CREDIT_COUNTER
	});
	const message = await buildLegacyMessage(rpc, payer, flattenPlan(plan));
	return sendAndConfirm(rpc, await signMessage(message));
}
