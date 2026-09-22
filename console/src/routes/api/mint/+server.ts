import type { RequestHandler } from './$types';
import { actionResponse, baseActivity, handle, requireNumber, requireString } from '$lib/server/api';
import { uiToBase } from '$lib/server/amounts';
import { mintSupply } from '$lib/server/ops/mint';

// Minting is a mint-authority action (the server always holds that key)
// rather than something either persona does, and it never touches
// confidential state, so it takes no role.
export const POST: RequestHandler = (event) =>
	handle(event, async (ctx, roles, body) => {
		const accountId = requireString(body, 'accountId');
		const amount = requireNumber(body, 'amount');
		const amountBase = uiToBase(amount);
		const recipient = ctx.signerFor(accountId);
		const signature = await mintSupply(ctx.rpc, ctx.payer, ctx.mint, ctx.mintAuthority, recipient.address, amountBase);
		await ctx.store.activityAppend({
			...baseActivity(signature, [{ label: 'mint', signature }], {
				type: 'mint',
				fromAccountId: 'mint',
				toAccountId: accountId,
				privacy: 'public'
			}),
			publicAmountUi: amount
		});
		return actionResponse(ctx, roles, signature, [signature]);
	});
