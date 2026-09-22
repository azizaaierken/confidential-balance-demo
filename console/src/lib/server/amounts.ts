import { MINT_DECIMALS } from './config';

/**
 * Largest UI amount a request may carry. Well above anything the demo mints,
 * and far below where number -> bigint conversion would start losing precision.
 */
export const MAX_UI_AMOUNT = 1_000_000_000;

const SCALE = 10 ** MINT_DECIMALS;

/**
 * Convert a UI amount to base units, refusing anything that isn't a positive
 * finite number in range. Without this a negative or NaN amount would
 * saturate to 0 and a zero-value transaction would be built, proved and paid
 * for.
 */
export function uiToBase(ui: unknown): bigint {
	if (typeof ui !== 'number' || !Number.isFinite(ui)) {
		throw new AmountError('amount must be a finite number');
	}
	if (ui <= 0) throw new AmountError('amount must be greater than zero');
	if (ui > MAX_UI_AMOUNT) throw new AmountError(`amount exceeds the maximum of ${MAX_UI_AMOUNT}`);
	const base = Math.round(ui * SCALE);
	if (base < 1) throw new AmountError(`amount is below the smallest unit (${MINT_DECIMALS} decimals)`);
	return BigInt(base);
}

export function baseToUi(base: bigint | number): number {
	return Number(base) / SCALE;
}

export class AmountError extends Error {}
