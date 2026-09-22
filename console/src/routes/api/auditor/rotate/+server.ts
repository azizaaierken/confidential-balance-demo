import type { RequestHandler } from './$types';
import { handle } from '$lib/server/api';
import { deriveAuditorGeneration, elgamalPubkeyToAddress } from '$lib/server/keys';
import { rotateAuditorKey } from '$lib/server/ops/mint';
import { requireAuditor } from '$lib/server/roles';
import { readState } from '$lib/server/state';

/**
 * Auditor-key rotation: derive generation N+1 from the root key, point the
 * mint at it, then record it. Generations are pure functions of the root,
 * the mint and N, so nothing new is stored anywhere; if the bookkeeping
 * after the on-chain update fails, the next request re-resolves the active
 * generation from the chain and backfills the registry.
 */
export const POST: RequestHandler = (event) =>
	handle(event, async (ctx, roles) => {
		requireAuditor(roles);
		const current = await ctx.activeGeneration();
		const next = current.generation + 1;
		const elgamal = await deriveAuditorGeneration(ctx.auditorRoot, ctx.mint, next);
		await rotateAuditorKey(ctx.rpc, ctx.payer, ctx.mint, ctx.mintAuthority, elgamal);
		await ctx.store.generationRotate(next, elgamalPubkeyToAddress(elgamal), Date.now());
		await ctx.activeGeneration();
		return readState(ctx, roles);
	});
