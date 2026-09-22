import { describe, expect, it } from 'vitest';
import { MemoryStore } from './memory';

describe('memory store generations', () => {
	it('keeps exactly the newest generation active', async () => {
		const s = new MemoryStore();
		await s.generationEnsure(1, 'A', 10);
		await s.generationRotate(2, 'B', 20);
		const all = await s.generationsAll();
		expect(all.map((g) => [g.generation, g.status, g.retiredAt])).toEqual([
			[1, 'retired', 20],
			[2, 'active', null]
		]);
		expect(all[1].id).toBe('auditor-key-gen-2');
	});

	it('ensure is idempotent and backfills an older generation as retired', async () => {
		const s = new MemoryStore();
		await s.generationEnsure(3, 'C', 30);
		await s.generationEnsure(3, 'C', 31);
		await s.generationEnsure(1, 'A', 32);
		const all = await s.generationsAll();
		expect(all.map((g) => [g.generation, g.status])).toEqual([
			[1, 'retired'],
			[3, 'active']
		]);
	});

	it('activity is newest-first and disclosure updates persist', async () => {
		const s = new MemoryStore();
		const base = {
			type: 'mint' as const,
			fromAccountId: 'mint',
			toAccountId: 'sender',
			status: 'confirmed' as const,
			privacy: 'public' as const,
			signature: 's',
			signatures: ['s'],
			steps: [],
			publicAmountUi: 1,
			auditorKeyGenerationId: null,
			auditorCiphertextLoHex: null,
			auditorCiphertextHiHex: null,
			disclosedAmountUi: null,
			partyAmountUi: null
		};
		await s.activityAppend({ ...base, id: 'a', timestamp: 1 });
		await s.activityAppend({ ...base, id: 'b', timestamp: 2 });
		expect((await s.activityAll()).map((a) => a.id)).toEqual(['b', 'a']);
		await s.activitySetDisclosed('a', 5);
		expect((await s.activityFind('a'))?.disclosedAmountUi).toBe(5);
	});
});
