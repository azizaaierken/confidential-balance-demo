/**
 * Database wiring (Drizzle ORM + node-postgres).
 *
 * Connects lazily and no-ops when DATABASE_URL is unset, so the first deploy
 * works before `provision_database` has run and local `bun run dev` works
 * with no Postgres at all (the store falls back to memory — see store.ts).
 *
 * In production DATABASE_URL points at a Cloud SQL unix socket:
 *   postgresql://user:pass@/dbname?host=/cloudsql/{project}:{region}:apps-pg
 * `pg` parses the `host` query param natively.
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { readEnv } from './config';
import { CREATE_TABLES_SQL } from './store/schema';

let _db: NodePgDatabase | null = null;
let _schemaReady: Promise<void> | null = null;

export function getDb(): NodePgDatabase | null {
	const url = readEnv('DATABASE_URL');
	if (!url) return null;
	if (!_db) {
		// Keep the pool tiny: Cloud Run runs at most two instances against a shared instance.
		const pool = new pg.Pool({ connectionString: url, max: 5 });
		_db = drizzle(pool);
	}
	return _db;
}

/** Create the tables if they don't exist yet. Runs once per process. */
export async function ensureSchema(db: NodePgDatabase): Promise<void> {
	if (!_schemaReady) {
		_schemaReady = (async () => {
			const client = (db as unknown as { $client: pg.Pool }).$client;
			await client.query(CREATE_TABLES_SQL);
		})().catch((e) => {
			_schemaReady = null;
			throw e;
		});
	}
	return _schemaReady;
}
