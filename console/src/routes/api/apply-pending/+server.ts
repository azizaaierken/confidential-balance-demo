import type { RequestHandler } from './$types';
import { actionResponse, baseActivity, handle, requireString } from '$lib/server/api';
import { baseToUi } from '$lib/server/amounts';
import { applyPending } from '$lib/server/ops/applyPending';
import { requireOwner } from '$lib/server/roles';

export const POST: RequestHandler = (event) =>
	handle(event, async (ctx, roles, body) => {
		const accountId = requireString(body, 'accountId');
		requireOwner(roles, accountId);
		const outcome = await applyPending(ctx.rpc, ctx.payer, ctx.signerFor(accountId), ctx.mint);
		const signature = outcome.signature;
		await ctx.store.activityAppend({
			...baseActivity(signature, [{ label: 'apply_pending', signature }], {
				type: 'apply_pending',
				fromAccountId: accountId,
				toAccountId: accountId,
				privacy: 'confidential'
			}),
			// The applied amount is still a confidential amount (moved from
			// pending into available, both encrypted), so it is redacted the same
			// way a transfer's own amount is: visible only to this account's owner.
			partyAmountUi: baseToUi(outcome.appliedAmount)
		});
		return actionResponse(ctx, roles, signature, [signature]);
	});
