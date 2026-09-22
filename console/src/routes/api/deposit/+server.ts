import type { RequestHandler } from './$types';
import { actionResponse, baseActivity, handle, requireNumber, requireString } from '$lib/server/api';
import { uiToBase } from '$lib/server/amounts';
import { deposit } from '$lib/server/ops/deposit';
import { requireOwner } from '$lib/server/roles';

export const POST: RequestHandler = (event) =>
	handle(event, async (ctx, roles, body) => {
		const accountId = requireString(body, 'accountId');
		requireOwner(roles, accountId);
		const amount = requireNumber(body, 'amount');
		const amountBase = uiToBase(amount);
		const signature = await deposit(ctx.rpc, ctx.payer, ctx.signerFor(accountId), ctx.mint, amountBase);
		await ctx.store.activityAppend({
			...baseActivity(signature, [{ label: 'deposit', signature }], {
				type: 'deposit',
				fromAccountId: accountId,
				toAccountId: accountId,
				privacy: 'public'
			}),
			publicAmountUi: amount
		});
		return actionResponse(ctx, roles, signature, [signature]);
	});
