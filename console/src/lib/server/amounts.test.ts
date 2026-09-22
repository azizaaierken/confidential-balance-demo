import { describe, expect, it } from 'vitest';
import { MAX_UI_AMOUNT, baseToUi, uiToBase } from './amounts';

describe('uiToBase', () => {
	it('scales by the mint decimals', () => {
		expect(uiToBase(1)).toBe(100n);
		expect(uiToBase(0.01)).toBe(1n);
		expect(uiToBase(12.345)).toBe(1235n);
	});

	it('rejects non-positive and non-finite amounts', () => {
		for (const bad of [0, -1, -0.001, NaN, Infinity, -Infinity, '1', null, undefined]) {
			expect(() => uiToBase(bad)).toThrow();
		}
	});

	it('rejects sub-unit and oversized amounts', () => {
		expect(() => uiToBase(0.001)).toThrow();
		expect(() => uiToBase(MAX_UI_AMOUNT * 2)).toThrow();
		expect(uiToBase(MAX_UI_AMOUNT)).toBe(BigInt(MAX_UI_AMOUNT) * 100n);
	});

	it('round-trips through baseToUi', () => {
		expect(baseToUi(uiToBase(42.5))).toBe(42.5);
	});
});
