import { ensureSchema, getDb } from '../db';
import { MemoryStore } from './memory';
import { PostgresStore } from './postgres';
import type { Store } from './types';

export type * from './types';

let _store: Store | null = null;
let warned = false;

/** Postgres when DATABASE_URL is set, otherwise a process-local memory store. */
export async function getStore(): Promise<Store> {
	if (_store) return _store;
	const db = getDb();
	if (db) {
		await ensureSchema(db);
		_store = new PostgresStore(db);
	} else {
		if (!warned) {
			warned = true;
			console.warn('DATABASE_URL is not set: activity, disclosures and the generation timeline live in memory only');
		}
		_store = new MemoryStore();
	}
	return _store;
}
