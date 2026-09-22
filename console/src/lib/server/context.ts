/**
 * The per-process application context: RPC client, the demo's signers, and
 * the active auditor generation. Loaded lazily on the first request so a
 * container with no secrets yet still boots and serves the health route.
 */
import type { Address, KeyPairSigner } from '@solana/kit';
import { fetchMintRequired } from './accounts';
import { deriveAuditorGeneration, elgamalPubkeyToAddress, loadDemoSigners, type DemoSigners } from './keys';
import { decodeMintConfig } from './ops/mint';
import { resolveActiveGeneration, type ResolvedGeneration } from './ops/auditor';
import { getRpc, getRpcUrl, type SolanaRpc } from './rpc';
import { getStore, type Store } from './store';

export type AppContext = DemoSigners & {
	rpc: SolanaRpc;
	rpcUrl: string;
	store: Store;
	signerFor(accountId: string): KeyPairSigner;
	/**
	 * Resolve the active generation from the mint's on-chain auditor key.
	 * Pass the key when the caller has just read the mint, to skip a fetch.
	 */
	activeGeneration(onChainAuditor?: Address | null): Promise<ResolvedGeneration>;
};

let _ctx: Promise<AppContext> | null = null;

export function getContext(): Promise<AppContext> {
	if (!_ctx) {
		_ctx = buildContext().catch((e) => {
			_ctx = null;
			throw e;
		});
	}
	return _ctx;
}

async function buildContext(): Promise<AppContext> {
	const signers = await loadDemoSigners();
	const rpc = getRpc();
	const store = await getStore();

	let cachedGeneration: ResolvedGeneration | null = null;
	const ctx: AppContext = {
		...signers,
		rpc,
		rpcUrl: getRpcUrl(),
		store,
		signerFor(accountId: string) {
			if (accountId === 'sender') return signers.sender;
			if (accountId === 'receiver') return signers.receiver;
			throw new RequestError(`unknown accountId: ${accountId}`);
		},
		async activeGeneration(onChainAuditor?: Address | null) {
			const auditor =
				onChainAuditor === undefined
					? decodeMintConfig(await fetchMintRequired(rpc, signers.mint)).auditorElgamalPubkey
					: onChainAuditor;
			if (cachedGeneration && cachedGeneration.pubkey === auditor) return cachedGeneration;
			const resolved = await resolveActiveGeneration(
				signers.auditorRoot,
				signers.mint,
				auditor,
				cachedGeneration ? cachedGeneration.generation + 1 : 1
			);
			if (!resolved) {
				throw new Error(`the mint's auditor key ${auditor} was not derived from this AUDITOR_ROOT_KEYPAIR`);
			}
			cachedGeneration = resolved;
			// Every generation below the active one must have existed, so backfill
			// the timeline (no-op for rows already there; on the memory store the
			// created/retired times of backfilled rows are approximate).
			const now = Date.now();
			for (let g = 1; g < resolved.generation; g++) {
				const older = await deriveAuditorGeneration(signers.auditorRoot, signers.mint, g);
				await store.generationEnsure(g, elgamalPubkeyToAddress(older), now);
			}
			await store.generationEnsure(resolved.generation, resolved.pubkey, now);
			return resolved;
		}
	};
	return ctx;
}

/** The caller asked for something malformed (400), as opposed to something that failed while running (500). */
export class RequestError extends Error {}

export type { Address };
