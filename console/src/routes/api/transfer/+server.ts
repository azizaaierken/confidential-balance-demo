import type { RequestHandler } from './$types';
import { actionResponse, baseActivity, handle, requireNumber, requireString } from '$lib/server/api';
import { uiToBase } from '$lib/server/amounts';
import { RequestError } from '$lib/server/context';
import { generationId } from '$lib/server/ops/auditor';
import { transferConfidential } from '$lib/server/ops/transfer';
import { requireOwner } from '$lib/server/roles';

export const POST: RequestHandler = (event) =>
	handle(event, async (ctx, roles, body) => {
		const from = requireString(body, 'fromAccountId');
		const to = requireString(body, 'toAccountId');
		requireOwner(roles, from);
		// Token-2022 happily processes a transfer whose source and destination
		// are the same account — it moves the amount from available into that
		// account's own pending balance, paying a fee to achieve nothing.
		if (from === to) throw new RequestError("a transfer's sender and recipient must be different accounts");
		const amount = requireNumber(body, 'amount');
		const amountBase = uiToBase(amount);
		const sender = ctx.signerFor(from);
		const recipient = ctx.signerFor(to).address;

		// Which generation the auditor ciphertext was encrypted to is whatever
		// the mint points at right now; resolve it before sending.
		const generation = await ctx.activeGeneration();
		const result = await transferConfidential(ctx.rpc, ctx.payer, sender, ctx.mint, recipient, amountBase);
		const signature = result.steps[result.steps.length - 1].signature;
		await ctx.store.activityAppend({
			...baseActivity(signature, result.steps, {
				type: 'confidential_transfer',
				fromAccountId: from,
				toAccountId: to,
				privacy: 'confidential'
			}),
			auditorKeyGenerationId: generationId(generation.generation),
			auditorCiphertextLoHex: result.auditorCiphertextLoHex,
			auditorCiphertextHiHex: result.auditorCiphertextHiHex,
			partyAmountUi: amount
		});
		return actionResponse(ctx, roles, signature, result.steps.map((s) => s.signature));
	});
