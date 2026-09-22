/**
 * Mint-level operations: create the confidential-transfer mint, mint public
 * supply, and rotate the mint-level auditor ElGamal key.
 */
import { getCreateAccountInstruction } from '@solana-program/system';
import {
	TOKEN_2022_PROGRAM_ADDRESS,
	getInitializeConfidentialTransferMintInstruction,
	getInitializeMintInstruction,
	getMintSize,
	getMintToInstruction,
	getUpdateConfidentialTransferMintInstruction,
	extension
} from '@solana-program/token-2022';
import { isSome, none, some, type Address, type KeyPairSigner, type Signature } from '@solana/kit';
import type { ElGamalKeypair } from '@solana/zk-sdk';
import { ataFor, confidentialMintExt, fetchMintRequired } from '../accounts';
import { MINT_DECIMALS } from '../config';
import { elgamalPubkeyToAddress } from '../keys';
import { sendAndConfirm, signMessage, type SolanaRpc } from '../rpc';
import { buildLegacyMessage } from '../tx';

export type ConfidentialMintConfig = {
	authority: Address | null;
	autoApproveNewAccounts: boolean;
	auditorElgamalPubkey: Address | null;
	supply: bigint;
};

export function decodeMintConfig(mint: Awaited<ReturnType<typeof fetchMintRequired>>): ConfidentialMintConfig {
	const ext = confidentialMintExt(mint);
	return {
		authority: isSome(ext.authority) ? ext.authority.value : null,
		autoApproveNewAccounts: ext.autoApproveNewAccounts,
		auditorElgamalPubkey: isSome(ext.auditorElgamalPubkey) ? ext.auditorElgamalPubkey.value : null,
		supply: mint.supply
	};
}

export async function readMintConfig(rpc: SolanaRpc, mint: Address): Promise<ConfidentialMintConfig> {
	return decodeMintConfig(await fetchMintRequired(rpc, mint));
}

export async function createConfidentialMint(
	rpc: SolanaRpc,
	payer: KeyPairSigner,
	mint: KeyPairSigner,
	mintAuthority: KeyPairSigner,
	auditorElgamal: ElGamalKeypair
): Promise<Signature> {
	const auditor = elgamalPubkeyToAddress(auditorElgamal);
	const space = BigInt(
		getMintSize([
			extension('ConfidentialTransferMint', {
				authority: some(mintAuthority.address),
				autoApproveNewAccounts: true,
				auditorElgamalPubkey: some(auditor)
			})
		])
	);
	const lamports = await rpc.getMinimumBalanceForRentExemption(space).send();
	const instructions = [
		getCreateAccountInstruction({
			payer,
			newAccount: mint,
			lamports,
			space,
			programAddress: TOKEN_2022_PROGRAM_ADDRESS
		}),
		// Extension initialisation must precede the base InitializeMint.
		getInitializeConfidentialTransferMintInstruction({
			mint: mint.address,
			authority: some(mintAuthority.address),
			autoApproveNewAccounts: true,
			auditorElgamalPubkey: some(auditor)
		}),
		getInitializeMintInstruction({
			mint: mint.address,
			decimals: MINT_DECIMALS,
			mintAuthority: mintAuthority.address,
			freezeAuthority: none()
		})
	];
	const message = await buildLegacyMessage(rpc, payer, instructions);
	return sendAndConfirm(rpc, await signMessage(message));
}

/** Update the mint's auditor ElGamal pubkey (auditor-key rotation). */
export async function rotateAuditorKey(
	rpc: SolanaRpc,
	payer: KeyPairSigner,
	mint: Address,
	mintAuthority: KeyPairSigner,
	newAuditor: ElGamalKeypair
): Promise<Signature> {
	const ix = getUpdateConfidentialTransferMintInstruction({
		mint,
		authority: mintAuthority,
		autoApproveNewAccounts: true,
		auditorElgamalPubkey: some(elgamalPubkeyToAddress(newAuditor))
	});
	const message = await buildLegacyMessage(rpc, payer, [ix]);
	return sendAndConfirm(rpc, await signMessage(message));
}

export async function mintSupply(
	rpc: SolanaRpc,
	payer: KeyPairSigner,
	mint: Address,
	mintAuthority: KeyPairSigner,
	recipientOwner: Address,
	amountBase: bigint
): Promise<Signature> {
	const ix = getMintToInstruction({
		mint,
		token: await ataFor(recipientOwner, mint),
		mintAuthority,
		amount: amountBase
	});
	const message = await buildLegacyMessage(rpc, payer, [ix]);
	return sendAndConfirm(rpc, await signMessage(message));
}
