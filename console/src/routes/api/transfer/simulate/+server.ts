import type { RequestHandler } from './$types';
import { handle, requireNumber, requireString } from '$lib/server/api';
import { uiToBase } from '$lib/server/amounts';
import { RequestError } from '$lib/server/context';
import { simulateTransfer } from '$lib/server/ops/transfer';
import { requireOwner } from '$lib/server/roles';

/**
 * Pre-flight for a transfer the caller hasn't committed to yet: builds the
 * real transaction and has the cluster simulate it. Gated on the same owner
 * role a real send needs — the verdict is the sender's business.
 */
export const POST: RequestHandler = (event) =>
	handle(event, async (ctx, roles, body) => {
		const from = requireString(body, 'fromAccountId');
		const to = requireString(body, 'toAccountId');
		requireOwner(roles, from);
		if (from === to) throw new RequestError("a transfer's sender and recipient must be different accounts");
		const amountBase = uiToBase(requireNumber(body, 'amount'));
		const sim = await simulateTransfer(ctx.rpc, ctx.payer, ctx.signerFor(from), ctx.mint, ctx.signerFor(to).address, amountBase);
		return { ok: true, ...sim };
	});
