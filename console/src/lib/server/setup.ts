/**
 * Idempotent devnet setup shared by `bun run bootstrap` and `bun run spike`:
 * make sure the payer is funded, the confidential mint exists and both
 * personas' token accounts are configured. Never runs inside the deployed
 * app — Cloud Run has no disk and should not be creating mints.
 */
import type { Address, KeyPairSigner } from '@solana/kit';
import { ataFor, fetchMintOrNull } from './accounts';
import { deriveAuditorGeneration } from './keys';
import { configureAccount, isConfigured } from './ops/configure';
import { createConfidentialMint } from './ops/mint';
import { sleep, type SolanaRpc } from './rpc';

const MIN_PAYER_LAMPORTS = 200_000_000n;
const AIRDROP_LAMPORTS = 1_000_000_000n;

export function fundingHint(payer: Address): string {
	return (
		`fund it from a wallet that already has devnet SOL, e.g. ` +
		`\`solana transfer --url devnet --allow-unfunded-recipient ${payer} 2\`, ` +
		`or use https://faucet.solana.com, then re-run bootstrap`
	);
}

/**
 * Tries a devnet airdrop first, but the public faucet is heavily rate-limited
 * and often refuses outright, so the failure spells out the reliable
 * alternative: a transfer from any wallet that already holds devnet SOL.
 */
export async function ensurePayerFunded(rpc: SolanaRpc, payer: KeyPairSigner): Promise<void> {
	const { value: lamports } = await rpc.getBalance(payer.address, { commitment: 'confirmed' }).send();
	if (lamports >= MIN_PAYER_LAMPORTS) return;
	let signature: string;
	try {
		signature = await rpc.requestAirdrop(payer.address, AIRDROP_LAMPORTS as never, { commitment: 'confirmed' }).send();
	} catch (e) {
		throw new Error(`airdrop to payer ${payer.address} was refused (${(e as Error).message}); ${fundingHint(payer.address)}`);
	}
	for (let i = 0; i < 30; i++) {
		await sleep(1000);
		const { value } = await rpc.getSignatureStatuses([signature as never]).send();
		const s = value[0];
		if (s && !s.err && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) return;
	}
	throw new Error(`airdrop to payer ${payer.address} did not confirm in time; ${fundingHint(payer.address)}`);
}

export async function ensureMint(
	rpc: SolanaRpc,
	payer: KeyPairSigner,
	mint: KeyPairSigner,
	mintAuthority: KeyPairSigner,
	auditorRoot: KeyPairSigner
): Promise<'created' | 'exists'> {
	if (await fetchMintOrNull(rpc, mint.address)) return 'exists';
	const gen1 = await deriveAuditorGeneration(auditorRoot, mint.address, 1);
	await createConfidentialMint(rpc, payer, mint, mintAuthority, gen1);
	return 'created';
}

export async function ensureConfidentialAccount(
	rpc: SolanaRpc,
	payer: KeyPairSigner,
	owner: KeyPairSigner,
	mint: Address
): Promise<'configured' | 'exists'> {
	const ata = await ataFor(owner.address, mint);
	if (await isConfigured(rpc, ata)) return 'exists';
	await configureAccount(rpc, payer, owner, mint);
	return 'configured';
}
