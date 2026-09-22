/**
 * Apply pending confidential balance to available confidential balance.
 * Decrypts pending + available client-side, re-encrypts the new available
 * balance with AES, and submits `ApplyPendingBalance`. No ZK proof needed.
 */
import { getApplyConfidentialPendingBalanceInstruction } from '@solana-program/token-2022';
import type { Address, KeyPairSigner, Signature } from '@solana/kit';
import {
	PENDING_BALANCE_LO_BITS,
	ataFor,
	fetchTokenRequired,
	parseAeCiphertext,
	requireConfidentialAccountExt,
	decryptCache
} from '../accounts';
import { deriveAccountKeys } from '../keys';
import { sendAndConfirm, signMessage, type SolanaRpc } from '../rpc';
import { buildLegacyMessage } from '../tx';

export type ApplyPendingOutcome = { signature: Signature; appliedAmount: bigint; newAvailable: bigint };

export async function applyPending(
	rpc: SolanaRpc,
	payer: KeyPairSigner,
	owner: KeyPairSigner,
	mint: Address
): Promise<ApplyPendingOutcome> {
	const tokenAccount = await ataFor(owner.address, mint);
	const { elgamal, aes } = await deriveAccountKeys(owner, tokenAccount);
	const token = await fetchTokenRequired(rpc, tokenAccount, 'token account');
	const ext = requireConfidentialAccountExt(token, `token account ${tokenAccount}`);

	const pendingLo = decryptCache.decrypt(ext.pendingBalanceLow, elgamal.secret(), 'pending_balance_lo');
	const pendingHi = decryptCache.decrypt(ext.pendingBalanceHigh, elgamal.secret(), 'pending_balance_hi');
	const currentAvailable = aes.decrypt(
		parseAeCiphertext(ext.decryptableAvailableBalance, 'decryptable_available_balance')
	);
	const pendingTotal = pendingLo + (pendingHi << PENDING_BALANCE_LO_BITS);
	const newAvailable = currentAvailable + pendingTotal;

	const ix = getApplyConfidentialPendingBalanceInstruction({
		token: tokenAccount,
		authority: owner,
		expectedPendingBalanceCreditCounter: ext.pendingBalanceCreditCounter,
		newDecryptableAvailableBalance: aes.encrypt(newAvailable).toBytes()
	});
	const message = await buildLegacyMessage(rpc, payer, [ix]);
	const signature = await sendAndConfirm(rpc, await signMessage(message));
	return { signature, appliedAmount: pendingTotal, newAvailable };
}
