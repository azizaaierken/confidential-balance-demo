/**
 * Shared plumbing for the JSON API routes: role parsing, error mapping and
 * the activity-record constructors every action uses.
 */
import './env-bridge';
import { json, type RequestEvent } from '@sveltejs/kit';
import { AmountError } from './amounts';
import { RequestError, getContext, type AppContext } from './context';
import { RoleError, rolesFor, type Role } from './roles';
import { readState } from './state';
import type { ActivityRecord } from './store';
import type { LabeledSignature } from './tx';
import { errorMessage } from './rpc';

export type Handler<T> = (ctx: AppContext, roles: Role[], body: Record<string, unknown>) => Promise<T>;

/** Run a handler, mapping thrown errors onto `{ ok: false, error }` with a status. */
export async function handle<T>(event: RequestEvent, fn: Handler<T>): Promise<Response> {
	const roles = rolesFor(event.request.headers);
	let body: Record<string, unknown> = {};
	if (event.request.method !== 'GET') {
		try {
			const text = await event.request.text();
			body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
		} catch {
			return json({ ok: false, error: 'request body must be JSON' }, { status: 400 });
		}
	}
	try {
		const ctx = await getContext();
		const result = await fn(ctx, roles, body);
		return json(result);
	} catch (e) {
		const message = errorMessage(e);
		const status = e instanceof RoleError ? 401 : e instanceof RequestError || e instanceof AmountError ? 400 : 500;
		console.warn(`handler error (${status}): ${message}`);
		return json({ ok: false, error: message }, { status });
	}
}

export function requireString(body: Record<string, unknown>, key: string): string {
	const v = body[key];
	if (typeof v !== 'string' || v.length === 0) throw new RequestError(`${key} must be a non-empty string`);
	return v;
}

export function requireNumber(body: Record<string, unknown>, key: string): number {
	const v = body[key];
	if (typeof v !== 'number') throw new RequestError(`${key} must be a number`);
	return v;
}

export function activityId(signature: string): string {
	return `act-${signature.slice(0, 12)}`;
}

export function baseActivity(
	signature: string,
	steps: LabeledSignature[],
	fields: Pick<ActivityRecord, 'type' | 'fromAccountId' | 'toAccountId' | 'privacy'>
): ActivityRecord {
	return {
		id: activityId(signature),
		status: 'confirmed',
		timestamp: Date.now(),
		signature,
		signatures: steps.map((s) => s.signature),
		steps,
		publicAmountUi: null,
		auditorKeyGenerationId: null,
		auditorCiphertextLoHex: null,
		auditorCiphertextHiHex: null,
		disclosedAmountUi: null,
		partyAmountUi: null,
		...fields
	};
}

export async function actionResponse(ctx: AppContext, roles: Role[], signature: string, signatures: string[]) {
	return { ok: true as const, signature, signatures, state: await readState(ctx, roles) };
}
