/**
 * Deposit tokens from public balance to pending confidential balance. No ZK
 * proof is required — deposit and withdrawal amounts stay plaintext; only
 * balances and confidential-to-confidential transfer amounts are hidden.
 */
import { getConfidentialDepositInstruction } from '@solana-program/token-2022';
import type { Address, KeyPairSigner, Signature } from '@solana/kit';
import { ataFor } from '../accounts';
import { MINT_DECIMALS } from '../config';
import { sendAndConfirm, signMessage, type SolanaRpc } from '../rpc';
import { buildLegacyMessage } from '../tx';

export async function deposit(
	rpc: SolanaRpc,
	payer: KeyPairSigner,
	owner: KeyPairSigner,
	mint: Address,
	amountBase: bigint
): Promise<Signature> {
	const ix = getConfidentialDepositInstruction({
		token: await ataFor(owner.address, mint),
		mint,
		authority: owner,
		amount: amountBase,
		decimals: MINT_DECIMALS
	});
	const message = await buildLegacyMessage(rpc, payer, [ix]);
	return sendAndConfirm(rpc, await signMessage(message));
}
