/**
 * RPC client plus the send/simulate/confirm plumbing every operation shares.
 *
 * Confirmation is done by polling `getSignatureStatuses` rather than through
 * a websocket subscription: it needs nothing beyond the HTTP endpoint, which
 * is the one thing every RPC provider and Cloud Run egress path agrees on.
 */
import {
	compileTransaction,
	createSolanaRpc,
	getBase64Decoder,
	getBase64EncodedWireTransaction,
	getSignatureFromTransaction,
	signTransactionMessageWithSigners,
	type Rpc,
	type Signature,
	type SolanaRpcApi,
	type Transaction,
	type TransactionMessage,
	type TransactionMessageWithBlockhashLifetime,
	type TransactionMessageWithFeePayer,
	type TransactionMessageWithLifetime,
	type TransactionWithLifetime
} from '@solana/kit';
import { rpcHost, rpcUrl } from './config';

export type SolanaRpc = Rpc<SolanaRpcApi>;

let _rpc: SolanaRpc | null = null;
let _rpcUrl: string | null = null;

export function getRpc(): SolanaRpc {
	if (!_rpc) {
		_rpcUrl = rpcUrl();
		console.log(`rpc endpoint: ${rpcHost(_rpcUrl)}`);
		_rpc = createSolanaRpc(_rpcUrl);
	}
	return _rpc;
}

export function getRpcUrl(): string {
	getRpc();
	return _rpcUrl!;
}

/**
 * The public devnet endpoint drops or resets connections often enough that a
 * read-only call failing once is not news. Retry transport-level failures a
 * few times with a short backoff before giving up.
 */
export async function withRpcRetry<T>(what: string, call: () => Promise<T>, attempts = 3): Promise<T> {
	let delay = 300;
	let lastErr: unknown;
	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			return await call();
		} catch (e) {
			lastErr = e;
			console.warn(`rpc ${what} attempt ${attempt}/${attempts} failed: ${errorMessage(e)}`);
			if (attempt < attempts) {
				await sleep(delay);
				delay *= 2;
			}
		}
	}
	throw new Error(`rpc ${what} failed after ${attempts} attempts: ${errorMessage(lastErr)}`);
}

export function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

export function errorMessage(e: unknown): string {
	if (e instanceof Error) {
		// Kit's SolanaError carries the useful part in `context`.
		const ctx = (e as { context?: unknown }).context;
		if (ctx && typeof ctx === 'object') {
			const c = ctx as Record<string, unknown>;
			const extra = c.__serverMessage ?? c.logs ?? c.transactionMessage;
			if (extra) return `${e.message} ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`;
		}
		return e.message;
	}
	return String(e);
}

export async function latestBlockhash(rpc: SolanaRpc) {
	const { value } = await withRpcRetry('getLatestBlockhash', () =>
		rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()
	);
	return value;
}

type SignableMessage = TransactionMessage &
	TransactionMessageWithFeePayer &
	TransactionMessageWithBlockhashLifetime;

/** Sign a fully-built message with every signer it references. */
export async function signMessage(message: SignableMessage) {
	return signTransactionMessageWithSigners(message);
}

/**
 * Send a signed transaction and poll until it reaches `confirmed` (or fails,
 * or the blockhash expires). Returns the signature.
 */
export async function sendAndConfirm(
	rpc: SolanaRpc,
	transaction: Transaction & TransactionWithLifetime
): Promise<Signature> {
	const wire = getBase64EncodedWireTransaction(transaction);
	const signature = getSignatureFromTransaction(transaction);
	await rpc
		.sendTransaction(wire, { encoding: 'base64', preflightCommitment: 'confirmed', maxRetries: 5n })
		.send();

	const lifetime = transaction.lifetimeConstraint as { lastValidBlockHeight?: bigint };
	const lastValid = lifetime.lastValidBlockHeight ?? BigInt(Number.MAX_SAFE_INTEGER);
	const deadline = Date.now() + 90_000;
	let tick = 0;
	while (Date.now() < deadline) {
		await sleep(tick === 0 ? 800 : 1500);
		tick++;
		const { value } = await rpc.getSignatureStatuses([signature]).send();
		const status = value[0];
		if (status) {
			if (status.err) {
				throw new Error(`transaction ${signature} failed: ${JSON.stringify(status.err)}`);
			}
			if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
				return signature;
			}
		}
		if (tick % 4 === 0) {
			const height = await rpc.getBlockHeight({ commitment: 'confirmed' }).send();
			if (height > lastValid) {
				if (await landed(rpc, signature)) return signature;
				throw new Error(`transaction ${signature} expired before confirmation (blockhash aged out)`);
			}
		}
	}
	// The transaction may still have landed while we were polling; the caller
	// records the auditor ciphertext only on success, so look one last time,
	// including in transaction history, before reporting a loss.
	if (await landed(rpc, signature)) return signature;
	throw new Error(`transaction ${signature} did not confirm in time`);
}

async function landed(rpc: SolanaRpc, signature: Signature): Promise<boolean> {
	try {
		const { value } = await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }).send();
		const s = value[0];
		return !!s && !s.err && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized');
	} catch {
		return false;
	}
}

export type Simulation = {
	success: boolean;
	error: string | null;
	logs: string[];
	unitsConsumed: number | null;
	feeLamports: number | null;
};

/**
 * Ask the cluster to simulate the exact signed transaction — the node's own
 * verdict, proofs included, not a local guess. The fee lookup is best-effort:
 * `feeLamports` is null if the node declines it, the simulation still stands.
 */
export async function simulate(rpc: SolanaRpc, message: SignableMessage): Promise<Simulation> {
	const signed = await signMessage(message);
	const wire = getBase64EncodedWireTransaction(signed);
	const { value } = await rpc
		.simulateTransaction(wire, { encoding: 'base64', sigVerify: true, commitment: 'confirmed' })
		.send();

	let feeLamports: number | null = null;
	try {
		const messageBase64 = getBase64Decoder().decode(compileTransaction(message).messageBytes);
		const fee = await rpc
			.getFeeForMessage(messageBase64 as Parameters<SolanaRpcApi['getFeeForMessage']>[0], {
				commitment: 'confirmed'
			})
			.send();
		feeLamports = fee.value === null ? null : Number(fee.value);
	} catch {
		feeLamports = null;
	}

	return {
		success: value.err === null,
		error: value.err === null ? null : JSON.stringify(value.err),
		logs: value.logs ?? [],
		unitsConsumed: value.unitsConsumed === undefined ? null : Number(value.unitsConsumed),
		feeLamports
	};
}

export type { TransactionMessageWithLifetime };
