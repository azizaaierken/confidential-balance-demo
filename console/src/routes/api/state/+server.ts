import type { RequestHandler } from './$types';
import { handle } from '$lib/server/api';
import { readState } from '$lib/server/state';

export const GET: RequestHandler = (event) => handle(event, (ctx, roles) => readState(ctx, roles));
