import type { RequestHandler } from './$types';
import { actionResponse, baseActivity, handle, requireNumber, requireString } from '$lib/server/api';
import { uiToBase } from '$lib/server/amounts';
import { withdraw } from '$lib/server/ops/withdraw';
import { requireOwner } from '$lib/server/roles';

export const POST: RequestHandler = (event) =>
	handle(event, async (ctx, roles, body) => {
		const accountId = requireString(body, 'accountId');
		requireOwner(roles, accountId);
		const amount = requireNumber(body, 'amount');
		const amountBase = uiToBase(amount);
		const outcome = await withdraw(ctx.rpc, ctx.payer, ctx.signerFor(accountId), ctx.mint, amountBase);
		const signature = outcome.steps[outcome.steps.length - 1].signature;
		await ctx.store.activityAppend({
			...baseActivity(signature, outcome.steps, {
				type: 'withdraw',
				fromAccountId: accountId,
				toAccountId: accountId,
				privacy: 'public'
			}),
			publicAmountUi: amount
		});
		return actionResponse(ctx, roles, signature, outcome.steps.map((s) => s.signature));
	});
