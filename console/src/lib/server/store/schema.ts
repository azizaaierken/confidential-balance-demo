import { bigint, doublePrecision, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';

/**
 * Postgres schema for the three logs the demo keeps: activity (every
 * operation the server performed, with its real signature and — for
 * confidential transfers — the auditor ciphertext captured at transfer time),
 * audit disclosures, and the auditor-key generation registry.
 *
 * Tables are created with `CREATE TABLE IF NOT EXISTS` on first connect (see
 * `db.ts`), so the canonical Dockerfile stays untouched.
 */

export const activity = pgTable('activity', {
	id: text('id').primaryKey(),
	type: text('type').notNull(),
	fromAccountId: text('from_account_id').notNull(),
	toAccountId: text('to_account_id').notNull(),
	status: text('status').notNull(),
	privacy: text('privacy').notNull(),
	timestamp: bigint('timestamp', { mode: 'number' }).notNull(),
	signature: text('signature').notNull(),
	signatures: jsonb('signatures').$type<string[]>().notNull(),
	steps: jsonb('steps').$type<{ label: string; signature: string; part?: number }[]>().notNull(),
	publicAmountUi: doublePrecision('public_amount_ui'),
	auditorKeyGenerationId: text('auditor_key_generation_id'),
	auditorCiphertextLoHex: text('auditor_ciphertext_lo_hex'),
	auditorCiphertextHiHex: text('auditor_ciphertext_hi_hex'),
	disclosedAmountUi: doublePrecision('disclosed_amount_ui'),
	partyAmountUi: doublePrecision('party_amount_ui')
});

export const disclosures = pgTable('audit_disclosures', {
	id: text('id').primaryKey(),
	activityId: text('activity_id').notNull(),
	requestedBy: text('requested_by').notNull(),
	reason: text('reason').notNull(),
	timestamp: bigint('timestamp', { mode: 'number' }).notNull(),
	keyGenerationId: text('key_generation_id').notNull(),
	decryptedAmountUi: doublePrecision('decrypted_amount_ui').notNull(),
	outcome: text('outcome').notNull()
});

export const auditorGenerations = pgTable('auditor_generations', {
	id: text('id').primaryKey(),
	generation: integer('generation').notNull(),
	label: text('label').notNull(),
	elgamalPubkey: text('elgamal_pubkey').notNull(),
	createdAt: bigint('created_at', { mode: 'number' }).notNull(),
	retiredAt: bigint('retired_at', { mode: 'number' }),
	status: text('status').notNull()
});

/** Idempotent DDL mirroring the tables above, run once per process. */
export const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS activity (
	id text PRIMARY KEY,
	type text NOT NULL,
	from_account_id text NOT NULL,
	to_account_id text NOT NULL,
	status text NOT NULL,
	privacy text NOT NULL,
	timestamp bigint NOT NULL,
	signature text NOT NULL,
	signatures jsonb NOT NULL,
	steps jsonb NOT NULL,
	public_amount_ui double precision,
	auditor_key_generation_id text,
	auditor_ciphertext_lo_hex text,
	auditor_ciphertext_hi_hex text,
	disclosed_amount_ui double precision,
	party_amount_ui double precision
);
CREATE TABLE IF NOT EXISTS audit_disclosures (
	id text PRIMARY KEY,
	activity_id text NOT NULL,
	requested_by text NOT NULL,
	reason text NOT NULL,
	timestamp bigint NOT NULL,
	key_generation_id text NOT NULL,
	decrypted_amount_ui double precision NOT NULL,
	outcome text NOT NULL
);
CREATE TABLE IF NOT EXISTS auditor_generations (
	id text PRIMARY KEY,
	generation integer NOT NULL,
	label text NOT NULL,
	elgamal_pubkey text NOT NULL,
	created_at bigint NOT NULL,
	retired_at bigint,
	status text NOT NULL
);
`;
