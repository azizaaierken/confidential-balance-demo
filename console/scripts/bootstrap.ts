/**
 * One-shot LOCAL setup against devnet. Safe to re-run — every step is
 * idempotent.
 *
 *   1. Generates any missing keypair (payer, mint authority, sender,
 *      receiver, auditor root) and appends it to console/.env. Secret values
 *      are written to that file only and never printed.
 *   2. Airdrops the payer, or prints its address for manual funding.
 *   3. Creates the confidential mint (auditor = generation 1) if MINT_ADDRESS
 *      is not set yet, and records the address in .env.
 *   4. Configures both personas' token accounts.
 *
 * Afterwards, upload console/.env to the deployed app with the
 * create_secrets_upload_url + set_secrets flow.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENV, MINT_DECIMALS, rpcUrl, readEnv } from '../src/lib/server/config';
import { ataFor } from '../src/lib/server/accounts';
import { deriveAuditorGeneration, elgamalPubkeyToAddress, generateKeypairBase58, signerFromBase58 } from '../src/lib/server/keys';
import { getRpc } from '../src/lib/server/rpc';
import { ensureConfidentialAccount, ensureMint, ensurePayerFunded } from '../src/lib/server/setup';
import type { Address } from '@solana/kit';

const ENV_PATH = resolve(import.meta.dir, '../.env');

function appendEnv(lines: Record<string, string>) {
	const existing = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
	const suffix = existing.length && !existing.endsWith('\n') ? '\n' : '';
	const added = Object.entries(lines)
		.map(([k, v]) => `${k}=${v}`)
		.join('\n');
	writeFileSync(ENV_PATH, `${existing}${suffix}${added}\n`, { mode: 0o600 });
	for (const [k, v] of Object.entries(lines)) process.env[k] = v;
}

async function ensureKeypair(name: string) {
	const existing = readEnv(name);
	if (existing) return signerFromBase58(existing);
	const { signer, encoded } = await generateKeypairBase58();
	appendEnv({ [name]: encoded });
	console.log(`generated ${name} -> ${signer.address}`);
	return signer;
}

async function main() {
	console.log(`rpc: ${rpcUrl()}`);
	if (!readEnv(ENV.RPC_URL) && !readEnv(ENV.HELIUS_RPC_URL)) {
		appendEnv({ [ENV.RPC_URL]: 'https://api.devnet.solana.com' });
	}
	const payer = await ensureKeypair(ENV.PAYER);
	const mintAuthority = await ensureKeypair(ENV.MINT_AUTHORITY);
	const sender = await ensureKeypair(ENV.SENDER);
	const receiver = await ensureKeypair(ENV.RECEIVER);
	const auditorRoot = await ensureKeypair(ENV.AUDITOR_ROOT);

	const rpc = getRpc();
	await ensurePayerFunded(rpc, payer);
	console.log(`payer funded: ${payer.address}`);

	let mint = readEnv(ENV.MINT_ADDRESS) as Address | undefined;
	if (!mint) {
		// The mint keypair only matters at creation (it signs create_account);
		// afterwards only the address does, so it is not kept.
		const { signer: mintSigner } = await generateKeypairBase58();
		const outcome = await ensureMint(rpc, payer, mintSigner, mintAuthority, auditorRoot);
		mint = mintSigner.address;
		appendEnv({ [ENV.MINT_ADDRESS]: mint });
		console.log(`mint ${outcome}: ${mint} (${MINT_DECIMALS} decimals)`);
	} else {
		console.log(`mint exists: ${mint}`);
	}

	for (const [label, owner] of [['sender', sender], ['receiver', receiver]] as const) {
		const outcome = await ensureConfidentialAccount(rpc, payer, owner, mint);
		console.log(`${label} ${owner.address} token account ${await ataFor(owner.address, mint)}: ${outcome}`);
	}

	const gen1 = await deriveAuditorGeneration(auditorRoot, mint, 1);
	console.log('devnet environment ready.');
	console.log(`  payer:          ${payer.address}`);
	console.log(`  mint:           ${mint}`);
	console.log(`  mint authority: ${mintAuthority.address}`);
	console.log(`  sender:         ${sender.address}`);
	console.log(`  receiver:       ${receiver.address}`);
	console.log(`  auditor root:   ${auditorRoot.address}`);
	console.log(`  auditor gen 1 ElGamal pubkey: ${elgamalPubkeyToAddress(gen1)}`);
	console.log(`secrets written to ${ENV_PATH} (never commit or print this file).`);
}

main().catch((e) => {
	console.error(`bootstrap failed: ${e instanceof Error ? e.message : e}`);
	process.exit(1);
});
