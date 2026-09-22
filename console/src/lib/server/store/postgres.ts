import { desc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { newGeneration } from './memory';
import { activity, auditorGenerations, disclosures } from './schema';
import type { ActivityRecord, DisclosureRecord, GenerationRecord, Store } from './types';

export class PostgresStore implements Store {
	readonly kind = 'postgres' as const;
	constructor(private db: NodePgDatabase) {}

	async activityAll(): Promise<ActivityRecord[]> {
		const rows = await this.db.select().from(activity).orderBy(desc(activity.timestamp));
		return rows.map(rowToActivity);
	}
	async activityFind(id: string) {
		const rows = await this.db.select().from(activity).where(eq(activity.id, id)).limit(1);
		return rows[0] ? rowToActivity(rows[0]) : null;
	}
	async activityAppend(entry: ActivityRecord) {
		await this.db.insert(activity).values(entry).onConflictDoNothing();
	}
	async activitySetDisclosed(id: string, amountUi: number) {
		await this.db.update(activity).set({ disclosedAmountUi: amountUi }).where(eq(activity.id, id));
	}
	async disclosuresAll(): Promise<DisclosureRecord[]> {
		const rows = await this.db.select().from(disclosures).orderBy(desc(disclosures.timestamp));
		return rows.map((r) => ({ ...r, outcome: r.outcome as DisclosureRecord['outcome'] }));
	}
	async disclosureAppend(entry: DisclosureRecord) {
		await this.db.insert(disclosures).values(entry).onConflictDoNothing();
	}
	async generationsAll(): Promise<GenerationRecord[]> {
		const rows = await this.db.select().from(auditorGenerations).orderBy(auditorGenerations.generation);
		return rows.map((r) => ({ ...r, status: r.status as GenerationRecord['status'] }));
	}
	async generationEnsure(generation: number, elgamalPubkey: string, now: number) {
		await this.db.insert(auditorGenerations).values(newGeneration(generation, elgamalPubkey, now)).onConflictDoNothing();
		await this.retireOlder(now);
	}
	async generationRotate(newGen: number, elgamalPubkey: string, now: number) {
		await this.db.insert(auditorGenerations).values(newGeneration(newGen, elgamalPubkey, now)).onConflictDoNothing();
		await this.retireOlder(now);
	}
	private async retireOlder(now: number) {
		const all = await this.generationsAll();
		if (all.length === 0) return;
		const newest = Math.max(...all.map((g) => g.generation));
		for (const g of all) {
			if (g.generation < newest && g.status === 'active') {
				await this.db
					.update(auditorGenerations)
					.set({ status: 'retired', retiredAt: now })
					.where(eq(auditorGenerations.id, g.id));
			}
		}
	}
}

function rowToActivity(r: typeof activity.$inferSelect): ActivityRecord {
	return {
		...r,
		type: r.type as ActivityRecord['type'],
		status: r.status as ActivityRecord['status'],
		privacy: r.privacy as ActivityRecord['privacy']
	};
}
