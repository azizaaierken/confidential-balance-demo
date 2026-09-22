import { describe, expect, it } from 'vitest';
import { redactForRoles } from './demo-store.svelte';
import { NO_ROLES } from '$lib/backend/client';
import type { AccountBalanceState, ActivityEntry } from '$lib/types';

function balance(accountId: string): AccountBalanceState {
	return {
		accountId,
		publicBalance: 10,
		confidentialAvailable: { ciphertext: '0xaa…bb', decrypted: 5 },
		confidentialPending: { ciphertext: '0xcc…dd', decrypted: 1 }
	};
}

const transfer: ActivityEntry = {
	id: 'act-1',
	type: 'confidential_transfer',
	fromAccountId: 'sender',
	toAccountId: 'receiver',
	status: 'confirmed',
	privacy: 'confidential',
	timestamp: 0,
	signature: 'sig',
	partyVisibleAmount: 42,
	confidential: { ciphertext: '0x..', auditorKeyGenerationId: 'gen-1', disclosedAmount: 42 },
	programActivity: [],
	steps: []
};

describe('redactForRoles', () => {
	const balances = { sender: balance('sender'), receiver: balance('receiver') };

	it('hides every confidential field when no role is switched on', () => {
		const { balances: b, activity } = redactForRoles(balances, [transfer], NO_ROLES);
		expect(b.sender.confidentialAvailable.decrypted).toBeNull();
		expect(b.receiver.confidentialPending.decrypted).toBeNull();
		expect(activity[0].partyVisibleAmount).toBeUndefined();
		expect(activity[0].confidential?.disclosedAmount).toBeUndefined();
	});

	it("keeps an owner's own balances and the amounts of transfers they are party to", () => {
		const { balances: b, activity } = redactForRoles(balances, [transfer], { ...NO_ROLES, sender: true });
		expect(b.sender.confidentialAvailable.decrypted).toBe(5);
		expect(b.receiver.confidentialAvailable.decrypted).toBeNull();
		expect(activity[0].partyVisibleAmount).toBe(42);
		// Party visibility never implies auditor disclosure.
		expect(activity[0].confidential?.disclosedAmount).toBeUndefined();
	});

	it('keeps disclosed amounts only for an auditor, without revealing balances', () => {
		const { balances: b, activity } = redactForRoles(balances, [transfer], { ...NO_ROLES, auditor: true });
		expect(activity[0].confidential?.disclosedAmount).toBe(42);
		expect(activity[0].partyVisibleAmount).toBeUndefined();
		expect(b.sender.confidentialAvailable.decrypted).toBeNull();
	});

	it('leaves public balances untouched', () => {
		const { balances: b } = redactForRoles(balances, [], NO_ROLES);
		expect(b.sender.publicBalance).toBe(10);
	});
});
