/**
 * Withdraw from confidential balance to public balance, V1 inline-proof
 * style: the equality and range proofs ride in the same version-1
 * transaction as the withdraw instruction via instruction offsets, so no
 * context-state accounts are needed.
 */
import { verifyBatchedRangeProofU64, verifyCiphertextCommitmentEquality } from '@solana-program/zk-elgamal-proof';
import { getConfidentialWithdrawInstruction } from '@solana-program/token-2022';
import { subtractAmountFromCiphertext } from '../ciphertext';
import type { Address, KeyPairSigner } from '@solana/kit';
import { BatchedRangeProofU64Data, CiphertextCommitmentEqualityProofData, PedersenCommitment, PedersenOpening } from '@solana/zk-sdk';
import {
	INSTRUCTIONS_SYSVAR,
	ataFor,
	fetchTokenRequired,
	parseAeCiphertext,
	parseElGamalCiphertext,
	requireConfidentialAccountExt
} from '../accounts';
import { MINT_DECIMALS } from '../config';
import { deriveAccountKeys } from '../keys';
import { sendAndConfirm, signMessage, type SolanaRpc } from '../rpc';
import { buildV1Message, type LabeledSignature } from '../tx';

const REMAINING_BALANCE_BITS = 64;

export type WithdrawOutcome = { steps: LabeledSignature[] };

export async function withdraw(
	rpc: SolanaRpc,
	payer: KeyPairSigner,
	owner: KeyPairSigner,
	mint: Address,
	amount: bigint
): Promise<WithdrawOutcome> {
	const tokenAccount = await ataFor(owner.address, mint);
	const { elgamal, aes } = await deriveAccountKeys(owner, tokenAccount);
	const token = await fetchTokenRequired(rpc, tokenAccount, 'token account');
	const ext = requireConfidentialAccountExt(token, `token account ${tokenAccount}`);

	// The ElGamal ciphertext is what the proof is generated against; the
	// plaintext comes from the owner's own AES copy of the same balance.
	const currentAvailable = aes.decrypt(parseAeCiphertext(ext.decryptableAvailableBalance, 'decryptable balance'));
	if (currentAvailable < amount) {
		throw new Error(`insufficient confidential balance: have ${currentAvailable}, need ${amount}`);
	}
	const newAvailable = currentAvailable - amount;

	const remainingOpening = new PedersenOpening();
	const remainingCommitment = PedersenCommitment.from(newAvailable, remainingOpening);
	const remainingCiphertext = parseElGamalCiphertext(
		subtractAmountFromCiphertext(ext.availableBalance, amount),
		'remaining balance'
	);
	const equalityProof = new CiphertextCommitmentEqualityProofData(
		elgamal,
		remainingCiphertext,
		remainingCommitment,
		remainingOpening,
		newAvailable
	);
	const rangeProof = new BatchedRangeProofU64Data(
		[remainingCommitment],
		new BigUint64Array([newAvailable]),
		Uint8Array.from([REMAINING_BALANCE_BITS]),
		[remainingOpening]
	);

	// Layout: [withdraw, equality, range]; the withdraw's offsets point
	// forward at +1 and +2.
	const withdrawIx = getConfidentialWithdrawInstruction({
		token: tokenAccount,
		mint,
		instructionsSysvar: INSTRUCTIONS_SYSVAR,
		authority: owner,
		amount,
		decimals: MINT_DECIMALS,
		newDecryptableAvailableBalance: aes.encrypt(newAvailable).toBytes(),
		equalityProofInstructionOffset: 1,
		rangeProofInstructionOffset: 2
	});
	const [equalityIx] = await verifyCiphertextCommitmentEquality({ rpc, payer, proofData: equalityProof.toBytes() });
	const [rangeIx] = await verifyBatchedRangeProofU64({ rpc, payer, proofData: rangeProof.toBytes() });

	const message = await buildV1Message(rpc, payer, [withdrawIx, equalityIx, rangeIx]);
	const signature = await sendAndConfirm(rpc, await signMessage(message));
	return { steps: [{ label: 'submit_withdraw_v1', signature }] };
}
