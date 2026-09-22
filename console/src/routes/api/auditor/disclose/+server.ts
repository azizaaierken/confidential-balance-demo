import type { RequestHandler } from './$types';
import { handle, requireString } from '$lib/server/api';
import { baseToUi } from '$lib/server/amounts';
import { RequestError } from '$lib/server/context';
import { deriveAuditorGeneration } from '$lib/server/keys';
import { decryptAuditorAmount } from '$lib/server/ops/auditor';
import { requireAuditor } from '$lib/server/roles';
import { readState } from '$lib/server/state';
import type { DisclosureRecord } from '$lib/server/store';

export const POST: RequestHandler = (event) =>
	handle(event, async (ctx, roles, body) => {
		requireAuditor(roles);
		const activityId = requireString(body, 'activityId');
		const keyGenerationId = requireString(body, 'keyGenerationId');
		const requestedBy = requireString(body, 'requestedBy');
		const reason = typeof body.reason === 'string' ? body.reason : '';

		const activity = await ctx.store.activityFind(activityId);
		if (!activity) throw new RequestError('unknown activityId');
		if (!activity.auditorCiphertextLoHex || !activity.auditorCiphertextHiHex) {
			throw new RequestError(`activity ${activityId} has no captured auditor ciphertext`);
		}
		const generation = (await ctx.store.generationsAll()).find((g) => g.id === keyGenerationId);
		if (!generation) throw new RequestError('unknown keyGenerationId');

		const elgamal = await deriveAuditorGeneration(ctx.auditorRoot, ctx.mint, generation.generation);
		const decrypted = decryptAuditorAmount(activity.auditorCiphertextLoHex, activity.auditorCiphertextHiHex, elgamal);

		const now = Date.now();
		const record: DisclosureRecord = {
			id: `disclosure-${crypto.randomUUID()}`,
			activityId,
			requestedBy,
			reason,
			timestamp: now,
			keyGenerationId,
			decryptedAmountUi: decrypted === null ? 0 : baseToUi(decrypted),
			outcome: decrypted === null ? 'wrong_key_generation' : 'success'
		};
		if (decrypted !== null) await ctx.store.activitySetDisclosed(activity.id, record.decryptedAmountUi);
		await ctx.store.disclosureAppend(record);
		return { ok: true, disclosure: record, state: await readState(ctx, roles) };
	});
