import { generationId, generationLabel } from '../ops/auditor';
import type { ActivityRecord, DisclosureRecord, GenerationRecord, Store } from './types';

/**
 * In-memory store used when DATABASE_URL is unset (local dev without
 * Postgres, or the very first deploy before `provision_database`). Nothing
 * survives a restart; the active auditor generation does, because it is
 * re-resolved from the mint on chain.
 */
export class MemoryStore implements Store {
	readonly kind = 'memory' as const;
	private activity: ActivityRecord[] = [];
	private disclosures: DisclosureRecord[] = [];
	private generations: GenerationRecord[] = [];

	async activityAll() {
		return this.activity.map((e) => ({ ...e }));
	}
	async activityFind(id: string) {
		const e = this.activity.find((a) => a.id === id);
		return e ? { ...e } : null;
	}
	async activityAppend(entry: ActivityRecord) {
		this.activity.unshift({ ...entry });
	}
	async activitySetDisclosed(id: string, amountUi: number) {
		const e = this.activity.find((a) => a.id === id);
		if (e) e.disclosedAmountUi = amountUi;
	}
	async disclosuresAll() {
		return this.disclosures.map((d) => ({ ...d }));
	}
	async disclosureAppend(entry: DisclosureRecord) {
		this.disclosures.unshift({ ...entry });
	}
	async generationsAll() {
		return [...this.generations].sort((a, b) => a.generation - b.generation);
	}
	async generationEnsure(generation: number, elgamalPubkey: string, now: number) {
		if (this.generations.some((g) => g.generation === generation)) return;
		this.generations.push(newGeneration(generation, elgamalPubkey, now));
		retireOlder(this.generations, now);
	}
	async generationRotate(newGen: number, elgamalPubkey: string, now: number) {
		this.generations.push(newGeneration(newGen, elgamalPubkey, now));
		retireOlder(this.generations, now);
	}
}

export function newGeneration(generation: number, elgamalPubkey: string, now: number): GenerationRecord {
	return {
		id: generationId(generation),
		generation,
		label: generationLabel(generation),
		elgamalPubkey,
		createdAt: now,
		retiredAt: null,
		status: 'active'
	};
}

/** Exactly one generation — the highest — stays active. */
export function retireOlder(generations: GenerationRecord[], now: number) {
	const newest = Math.max(...generations.map((g) => g.generation));
	for (const g of generations) {
		if (g.generation < newest && g.status === 'active') {
			g.status = 'retired';
			g.retiredAt = now;
		}
	}
}
