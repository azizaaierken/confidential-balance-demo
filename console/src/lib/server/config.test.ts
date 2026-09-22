import { afterEach, describe, expect, it } from 'vitest';
import { ENV, clusterLabel, devnetVariant, rpcHost, rpcUrl } from './config';

const saved: Record<string, string | undefined> = {};
function setEnv(name: string, value: string | undefined) {
	if (!(name in saved)) saved[name] = process.env[name];
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}
afterEach(() => {
	for (const [k, v] of Object.entries(saved)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
});

describe('rpc url selection', () => {
	it('swaps a Helius mainnet URL to devnet and keeps the key', () => {
		expect(devnetVariant('https://mainnet.helius-rpc.com/?api-key=abc')).toBe('https://devnet.helius-rpc.com/?api-key=abc');
		expect(devnetVariant('https://devnet.helius-rpc.com/?api-key=abc')).toBe('https://devnet.helius-rpc.com/?api-key=abc');
	});

	it('skips a non-devnet URL it cannot convert', () => {
		expect(devnetVariant('https://solana-mainnet.rpcpool.com/xyz')).toBeNull();
		expect(devnetVariant(undefined)).toBeNull();
	});

	it('prefers a usable shared key over SOLANA_RPC_URL, then falls back', () => {
		setEnv(ENV.HELIUS_RPC_URL, 'https://mainnet.helius-rpc.com/?api-key=k');
		setEnv(ENV.TRITON_RPC_URL, 'https://mainnet.rpcpool.com/t');
		setEnv(ENV.RPC_URL, 'https://api.devnet.solana.com');
		expect(rpcUrl()).toBe('https://devnet.helius-rpc.com/?api-key=k');
		setEnv(ENV.HELIUS_RPC_URL, undefined);
		expect(rpcUrl()).toBe('https://api.devnet.solana.com');
		setEnv(ENV.RPC_URL, undefined);
		setEnv(ENV.TRITON_RPC_URL, undefined);
		expect(rpcUrl()).toBe('https://api.devnet.solana.com');
	});

	it('labels clusters and hides query strings from log hosts', () => {
		expect(clusterLabel('https://devnet.helius-rpc.com/?api-key=k')).toBe('devnet');
		expect(clusterLabel('https://rpc.example.com')).toBe('custom');
		expect(rpcHost('https://devnet.helius-rpc.com/?api-key=k')).toBe('devnet.helius-rpc.com');
	});
});
