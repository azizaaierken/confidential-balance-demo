import { describe, expect, it } from 'vitest';
import { ROLES_HEADER, requireAuditor, requireOwner, rolesFor, rolesFromHeader } from './roles';

describe('demo roles', () => {
	it('no header means public observer', () => {
		expect(rolesFor(new Headers())).toEqual([]);
		expect(rolesFromHeader(null)).toEqual([]);
		expect(rolesFromHeader('')).toEqual([]);
	});

	it('parses any combination and ignores unknown names', () => {
		const headers = new Headers({ [ROLES_HEADER]: ' sender, auditor ,garbage,' });
		expect(rolesFor(headers)).toEqual(['sender', 'auditor']);
		expect(rolesFromHeader('sender,sender')).toEqual(['sender']);
	});

	it('owner check is per account', () => {
		expect(() => requireOwner(['sender'], 'sender')).not.toThrow();
		expect(() => requireOwner(['sender'], 'receiver')).toThrow();
		expect(() => requireOwner(['auditor'], 'sender')).toThrow();
		expect(() => requireOwner([], 'sender')).toThrow();
		expect(() => requireOwner(['sender'], 'mint')).toThrow();
	});

	it('auditor check requires the auditor role', () => {
		expect(() => requireAuditor(['auditor'])).not.toThrow();
		expect(() => requireAuditor(['sender', 'receiver'])).toThrow();
	});
});
