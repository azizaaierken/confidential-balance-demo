import { afterEach, describe, expect, it, vi } from 'vitest';
import * as backend from '$lib/backend/client';
import { demo } from './demo-store.svelte';

const emptyState: backend.BackendState = {
	mint: {
		address: 'm',
		name: 'Token-X',
		symbol: 'TOKEN-X',
		decimals: 2,
		programId: 'p',
		zkProofProgramId: 'z',
		confidentialTransferAuthority: 'a',
		feePayer: 'f',
		extensions: [],
		autoApproveNewAccounts: true,
		cluster: 'devnet'
	},
	totalSupply: 0,
	balances: {},
	personas: {},
	auditorKeyGenerations: [],
	activity: [],
	auditDisclosures: [],
	storage: 'memory'
};

afterEach(() => {
	vi.restoreAllMocks();
	demo.backendReady = false;
	demo.backendError = null;
	demo.network = 'connected';
	demo.viewRoles = { ...backend.NO_ROLES };
	demo.loadingViewRoles = { ...backend.NO_ROLES };
});

describe('refresh failures', () => {
	it('the first connection failing shows the error screen', async () => {
		vi.spyOn(backend, 'fetchState').mockRejectedValue(new Error('boom'));
		await expect(demo.hydrate()).rejects.toThrow('boom');
		expect(demo.backendReady).toBe(false);
		expect(demo.backendError).toBe('boom');
	});

	it('a refresh failing after a successful load only degrades the connection', async () => {
		vi.spyOn(backend, 'fetchState').mockResolvedValueOnce(emptyState);
		await demo.hydrate();
		expect(demo.backendReady).toBe(true);

		vi.spyOn(backend, 'fetchState').mockRejectedValueOnce(new Error('devnet hiccup'));
		await expect(demo.hydrate()).rejects.toThrow('devnet hiccup');
		expect(demo.backendReady).toBe(true);
		expect(demo.backendError).toBeNull();
		expect(demo.network).toBe('degraded');
	});

	it('switching a view on keeps the switch and degrades when the read fails', async () => {
		vi.spyOn(backend, 'fetchState').mockResolvedValueOnce(emptyState);
		await demo.hydrate();

		vi.spyOn(backend, 'fetchState').mockRejectedValueOnce(new Error('devnet hiccup'));
		await demo.setViewRole('auditor', true);
		expect(demo.viewRoles.auditor).toBe(true);
		expect(demo.backendError).toBeNull();
		expect(demo.network).toBe('degraded');
		expect(demo.loadingViewRoles.auditor).toBe(false);
	});

	it('marks a role as loading only while its data is in flight', async () => {
		vi.spyOn(backend, 'fetchState').mockResolvedValueOnce(emptyState);
		await demo.hydrate();

		let resolve!: (s: backend.BackendState) => void;
		vi.spyOn(backend, 'fetchState').mockReturnValueOnce(new Promise<backend.BackendState>((r) => (resolve = r)));
		const switching = demo.setViewRole('sender', true);
		expect(demo.viewRoles.sender).toBe(true);
		expect(demo.loadingViewRoles.sender).toBe(true);
		resolve(emptyState);
		await switching;
		expect(demo.loadingViewRoles.sender).toBe(false);
	});

	it('an older read landing after a newer one is ignored', async () => {
		let resolveOld!: (s: backend.BackendState) => void;
		const old = new Promise<backend.BackendState>((r) => (resolveOld = r));
		const spy = vi.spyOn(backend, 'fetchState');
		spy.mockReturnValueOnce(old);
		const oldRead = demo.hydrate();

		spy.mockResolvedValueOnce({ ...emptyState, totalSupply: 42 });
		await demo.hydrate();
		expect(demo.totalSupply).toBe(42);

		resolveOld({ ...emptyState, totalSupply: 1 });
		await oldRead;
		expect(demo.totalSupply).toBe(42);
	});

	it('switching a role off redacts immediately, before the read completes', async () => {
		vi.spyOn(backend, 'fetchState').mockResolvedValueOnce({
			...emptyState,
			balances: {
				sender: {
					accountId: 'sender',
					publicBalance: 1,
					confidentialAvailable: { ciphertext: 'c', decrypted: 7 },
					confidentialPending: { ciphertext: 'p', decrypted: 0 }
				}
			}
		});
		demo.viewRoles = { ...backend.NO_ROLES, sender: true };
		await demo.hydrate();
		expect(demo.balances.sender.confidentialAvailable.decrypted).toBe(7);

		vi.spyOn(backend, 'fetchState').mockReturnValueOnce(new Promise(() => {}));
		void demo.setViewRole('sender', false);
		expect(demo.balances.sender.confidentialAvailable.decrypted).toBeNull();
	});
});
