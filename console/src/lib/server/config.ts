/**
 * Runtime configuration for the server side of the console.
 *
 * Everything is read from the process environment so the same modules run
 * under `bun scripts/*.ts` (Bun loads `console/.env` itself) and inside the
 * SvelteKit server (adapter-node exposes the container's env; `vite dev`
 * bridges the `.env` file through `src/hooks.server.ts`).
 *
 * Secrets (the demo's keypairs) are never logged or echoed back to a client.
 */

export const MINT_DECIMALS = 2;

/** Names of the env vars the demo needs. Kept in one place for bootstrap. */
export const ENV = {
	RPC_URL: 'SOLANA_RPC_URL',
	HELIUS_RPC_URL: 'HELIUS_RPC_URL',
	TRITON_RPC_URL: 'TRITON_RPC_URL',
	PAYER: 'PAYER_KEYPAIR',
	MINT_AUTHORITY: 'MINT_AUTHORITY_KEYPAIR',
	SENDER: 'SENDER_KEYPAIR',
	RECEIVER: 'RECEIVER_KEYPAIR',
	AUDITOR_ROOT: 'AUDITOR_ROOT_KEYPAIR',
	MINT_ADDRESS: 'MINT_ADDRESS'
} as const;

export function readEnv(name: string): string | undefined {
	const v = process.env[name];
	return v === undefined || v === '' ? undefined : v;
}

export function requireEnv(name: string): string {
	const v = readEnv(name);
	if (!v) {
		throw new Error(`${name} is not set. Run \`bun run bootstrap\` locally, then upload console/.env with the set_secrets flow.`);
	}
	return v;
}

/**
 * The RPC endpoint. A platform-attached shared key (Helius, then Triton) wins
 * over the value in `.env`, and the public devnet endpoint is the fallback.
 *
 * This demo only ever runs against devnet, and a shared key is typically a
 * mainnet URL, so a shared URL is used only when it is (or can be made) a
 * devnet one: Helius keys work on every cluster, so its mainnet host is
 * swapped for the devnet host; any other non-devnet URL is skipped.
 */
export function rpcUrl(): string {
	for (const name of [ENV.HELIUS_RPC_URL, ENV.TRITON_RPC_URL]) {
		const candidate = devnetVariant(readEnv(name));
		if (candidate) return candidate;
	}
	return readEnv(ENV.RPC_URL) ?? 'https://api.devnet.solana.com';
}

/** The devnet form of a shared RPC URL, or null if it cannot be made one. */
export function devnetVariant(url: string | undefined): string | null {
	if (!url) return null;
	if (url.includes('devnet')) return url;
	if (/^https:\/\/mainnet\.helius-rpc\.com/.test(url)) return url.replace('https://mainnet.helius-rpc.com', 'https://devnet.helius-rpc.com');
	return null;
}

/** Host of an RPC URL for logs — never the query string, which may carry an API key. */
export function rpcHost(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return 'invalid-url';
	}
}

/** A short label for the cluster behind a URL, for display only. */
export function clusterLabel(url: string): string {
	if (url.includes('devnet')) return 'devnet';
	if (url.includes('testnet')) return 'testnet';
	if (url.includes('mainnet')) return 'mainnet-beta';
	if (url.includes('localhost') || url.includes('127.0.0.1')) return 'localnet';
	return 'custom';
}
