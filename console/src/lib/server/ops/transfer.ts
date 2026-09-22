/**
 * Confidential transfer between accounts, V1 inline-proof style.
 *
 * Builds the three transfer proofs (equality, ciphertext-validity, range)
 * with @solana/zk-sdk — mirroring the token-2022 helper's internal
 * `buildConfidentialTransferProofData` — and submits them alongside the
 * transfer instruction in ONE version-1 (SIMD-0385) transaction via
 * instruction offsets: the proof-verify instructions ride in the same
 * transaction, checked through instruction introspection, so no context-state
 * accounts are created or closed at all.
 *
 * This only fits because V1 raises the legacy 1,232-byte limit to 4,096:
 * the combined verify instructions plus the transfer come to ~2.4KB.
 *
 * The auditor's ElGamal ciphertext of the amount exists only in this
 * transaction's instruction data — Token-2022 does not persist it in any
 * account after confirmation — so it is captured here, at transfer time, for
 * later per-transfer auditor disclosure.
 *
 * `simulateTransfer` runs the identical build path and asks the cluster to
 * simulate the resulting transaction instead of sending it.
 */
import {
	verifyBatchedGroupedCiphertext3HandlesValidity,
	verifyBatchedRangeProofU128,
	verifyCiphertextCommitmentEquality
} from '@solana-program/zk-elgamal-proof';
import { decodeMint, decodeToken, getConfidentialTransferInstruction } from '@solana-program/token-2022';
import { extractCiphertextFromGroupedBytes, subtractWithLoHiCiphertexts } from '../ciphertext';
import { getAddressEncoder, type Address, type KeyPairSigner } from '@solana/kit';
import {
	BatchedGroupedCiphertext3HandlesValidityProofData,
	BatchedRangeProofU128Data,
	CiphertextCommitmentEqualityProofData,
	ElGamalPubkey,
	GroupedElGamalCiphertext3Handles,
	PedersenCommitment,
	PedersenOpening
} from '@solana/zk-sdk';
import {
	INSTRUCTIONS_SYSVAR,
	ataFor,
	fetchAccounts,
	parseAeCiphertext,
	parseElGamalCiphertext,
	requireConfidentialAccountExt,
	toHex
} from '../accounts';
import { deriveAccountKeys } from '../keys';
import { decodeMintConfig } from './mint';
import { sendAndConfirm, signMessage, simulate, type Simulation, type SolanaRpc } from '../rpc';
import { buildV1Message, type LabeledSignature } from '../tx';

/** The transfer amount is split into a 16-bit lo and a 32-bit hi half. */
const TRANSFER_AMOUNT_LO_BITS = 16n;
const TRANSFER_AMOUNT_HI_BITS = 32;
const REMAINING_BALANCE_BITS = 64;
/** The range proof batches to 128 bits: 64 + 16 + 32 + 16 of padding on a commitment of 0. */
const RANGE_PROOF_PADDING_BITS = 16;

export type TransferOutcome = {
	steps: LabeledSignature[];
	auditorCiphertextLoHex: string | null;
	auditorCiphertextHiHex: string | null;
};

type Built = {
	message: Awaited<ReturnType<typeof buildV1Message>>;
	auditorCiphertextLoHex: string | null;
	auditorCiphertextHiHex: string | null;
};

function elgamalPubkeyFromAddress(address: Address): ElGamalPubkey {
	return ElGamalPubkey.fromBytes(new Uint8Array(getAddressEncoder().encode(address)));
}

async function buildTransfer(
	rpc: SolanaRpc,
	payer: KeyPairSigner,
	sender: KeyPairSigner,
	mint: Address,
	recipient: Address,
	amount: bigint
): Promise<Built> {
	const sourceToken = await ataFor(sender.address, mint);
	const destinationToken = await ataFor(recipient, mint);

	const [sourceAcc, destAcc, mintAcc] = await fetchAccounts(rpc, [sourceToken, destinationToken, mint]);
	if (!sourceAcc.exists) throw new Error(`sender token account ${sourceToken} does not exist`);
	if (!destAcc.exists) throw new Error(`recipient token account ${destinationToken} does not exist`);
	if (!mintAcc.exists) throw new Error(`mint ${mint} not found on chain`);
	const source = requireConfidentialAccountExt(decodeToken(sourceAcc).data, 'sender token account');
	const destination = requireConfidentialAccountExt(decodeToken(destAcc).data, 'recipient token account');
	const mintConfig = decodeMintConfig(decodeMint(mintAcc).data);

	const { elgamal: sourceKeypair, aes } = await deriveAccountKeys(sender, sourceToken);
	const sourcePubkey = sourceKeypair.pubkey();
	const destinationPubkey = elgamalPubkeyFromAddress(destination.elgamalPubkey);
	const hasAuditor = mintConfig.auditorElgamalPubkey !== null;
	// With no auditor configured the protocol uses the zero pubkey.
	const auditorPubkey = hasAuditor
		? elgamalPubkeyFromAddress(mintConfig.auditorElgamalPubkey!)
		: ElGamalPubkey.fromBytes(new Uint8Array(32));

	const currentAvailable = aes.decrypt(
		parseAeCiphertext(source.decryptableAvailableBalance, 'sender decryptable balance')
	);
	if (currentAvailable < amount) {
		throw new Error(`insufficient available balance: have ${currentAvailable}, need ${amount}`);
	}
	const newAvailable = currentAvailable - amount;

	// --- amount split and grouped ciphertexts (source, destination, auditor)
	const amountLo = amount & ((1n << TRANSFER_AMOUNT_LO_BITS) - 1n);
	const amountHi = amount >> TRANSFER_AMOUNT_LO_BITS;
	const openingLo = new PedersenOpening();
	const openingHi = new PedersenOpening();
	const groupedLo = GroupedElGamalCiphertext3Handles.encryptWith(sourcePubkey, destinationPubkey, auditorPubkey, amountLo, openingLo);
	const groupedHi = GroupedElGamalCiphertext3Handles.encryptWith(sourcePubkey, destinationPubkey, auditorPubkey, amountHi, openingHi);
	const groupedLoBytes = groupedLo.toBytes();
	const groupedHiBytes = groupedHi.toBytes();
	const sourceCiphertextLo = extractCiphertextFromGroupedBytes(groupedLoBytes, 0);
	const sourceCiphertextHi = extractCiphertextFromGroupedBytes(groupedHiBytes, 0);
	const auditorCiphertextLo = extractCiphertextFromGroupedBytes(groupedLoBytes, 2);
	const auditorCiphertextHi = extractCiphertextFromGroupedBytes(groupedHiBytes, 2);

	// --- equality proof: new available ciphertext == commitment of new balance
	const newAvailableOpening = new PedersenOpening();
	const newAvailableCommitment = PedersenCommitment.from(newAvailable, newAvailableOpening);
	const newAvailableCiphertext = parseElGamalCiphertext(
		subtractWithLoHiCiphertexts(source.availableBalance, sourceCiphertextLo, sourceCiphertextHi, TRANSFER_AMOUNT_LO_BITS),
		'new available balance'
	);
	const equalityProof = new CiphertextCommitmentEqualityProofData(
		sourceKeypair,
		newAvailableCiphertext,
		newAvailableCommitment,
		newAvailableOpening,
		newAvailable
	);

	// --- validity proof over both grouped ciphertexts
	const validityProof = new BatchedGroupedCiphertext3HandlesValidityProofData(
		sourcePubkey,
		destinationPubkey,
		auditorPubkey,
		groupedLo,
		groupedHi,
		amountLo,
		amountHi,
		openingLo,
		openingHi
	);

	// --- range proof: [remaining 64, lo 16, hi 32, padding 16] = 128 bits
	const commitmentLo = PedersenCommitment.fromBytes(groupedLoBytes.slice(0, 32));
	const commitmentHi = PedersenCommitment.fromBytes(groupedHiBytes.slice(0, 32));
	const paddingOpening = new PedersenOpening();
	const paddingCommitment = PedersenCommitment.from(0n, paddingOpening);
	const rangeProof = new BatchedRangeProofU128Data(
		[newAvailableCommitment, commitmentLo, commitmentHi, paddingCommitment],
		new BigUint64Array([newAvailable, amountLo, amountHi, 0n]),
		Uint8Array.from([REMAINING_BALANCE_BITS, Number(TRANSFER_AMOUNT_LO_BITS), TRANSFER_AMOUNT_HI_BITS, RANGE_PROOF_PADDING_BITS]),
		[newAvailableOpening, openingLo, openingHi, paddingOpening]
	);

	// Instructions are laid out [equality, validity, range, transfer] so the
	// transfer's offsets point backward at each proof by a fixed negative
	// index — no context-state account anywhere.
	const [equalityIx] = await verifyCiphertextCommitmentEquality({ rpc, payer, proofData: equalityProof.toBytes() });
	const [validityIx] = await verifyBatchedGroupedCiphertext3HandlesValidity({ rpc, payer, proofData: validityProof.toBytes() });
	const [rangeIx] = await verifyBatchedRangeProofU128({ rpc, payer, proofData: rangeProof.toBytes() });
	const transferIx = getConfidentialTransferInstruction({
		sourceToken,
		mint,
		destinationToken,
		instructionsSysvar: INSTRUCTIONS_SYSVAR,
		authority: sender,
		newSourceDecryptableAvailableBalance: aes.encrypt(newAvailable).toBytes(),
		transferAmountAuditorCiphertextLo: auditorCiphertextLo,
		transferAmountAuditorCiphertextHi: auditorCiphertextHi,
		equalityProofInstructionOffset: -3,
		ciphertextValidityProofInstructionOffset: -2,
		rangeProofInstructionOffset: -1
	});

	const message = await buildV1Message(rpc, payer, [equalityIx, validityIx, rangeIx, transferIx]);
	return {
		message,
		auditorCiphertextLoHex: hasAuditor ? toHex(auditorCiphertextLo) : null,
		auditorCiphertextHiHex: hasAuditor ? toHex(auditorCiphertextHi) : null
	};
}

/** Build, sign, submit and confirm one confidential transfer. */
export async function transferConfidential(
	rpc: SolanaRpc,
	payer: KeyPairSigner,
	sender: KeyPairSigner,
	mint: Address,
	recipient: Address,
	amount: bigint
): Promise<TransferOutcome> {
	const built = await buildTransfer(rpc, payer, sender, mint, recipient, amount);
	const signature = await sendAndConfirm(rpc, await signMessage(built.message));
	return {
		steps: [{ label: 'submit_transfer_v1', signature }],
		auditorCiphertextLoHex: built.auditorCiphertextLoHex,
		auditorCiphertextHiHex: built.auditorCiphertextHiHex
	};
}

/**
 * Build the real transaction — proofs and all — and have the cluster
 * simulate it without submitting. Same code path as a send right up to
 * `sendTransaction`, so the verdict covers proof verification actually
 * passing, the compute budget actually sufficing, the accounts actually
 * being configured.
 */
export async function simulateTransfer(
	rpc: SolanaRpc,
	payer: KeyPairSigner,
	sender: KeyPairSigner,
	mint: Address,
	recipient: Address,
	amount: bigint
): Promise<Simulation> {
	const built = await buildTransfer(rpc, payer, sender, mint, recipient, amount);
	return simulate(rpc, built.message);
}
