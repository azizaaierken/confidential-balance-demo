/**
 * Demo role selection. There is no authentication in this demo: the frontend
 * tells the server which roles the viewer has switched on (any combination
 * of the sender, the receiver and the auditor) via a single
 * `X-Demo-Roles: sender,auditor` header, and the server reveals exactly what
 * that combination is entitled to see and permits exactly the actions those
 * roles may take.
 *
 * That header is a UI switch, not a credential. What it buys is fidelity:
 * every redaction and permission decision is made server-side, in one place,
 * from the roles a request presents. The app itself is gated by the
 * platform's Google SSO; `locals.userEmail` is display-only and never used
 * for authorization here.
 */

export const ROLES_HEADER = 'x-demo-roles';

export type Role = 'sender' | 'receiver' | 'auditor';

const ALL_ROLES: readonly Role[] = ['sender', 'receiver', 'auditor'];

export function parseRole(s: string): Role | null {
	return (ALL_ROLES as readonly string[]).includes(s) ? (s as Role) : null;
}

/**
 * Every role this request is viewing as, from the header (comma-separated;
 * unknown names are ignored rather than failing the request). No header
 * means a public observer.
 */
export function rolesFromHeader(raw: string | null | undefined): Role[] {
	if (!raw) return [];
	const roles: Role[] = [];
	for (const part of raw.split(',')) {
		const role = parseRole(part.trim());
		if (role && !roles.includes(role)) roles.push(role);
	}
	return roles;
}

export function rolesFor(headers: Headers): Role[] {
	return rolesFromHeader(headers.get(ROLES_HEADER));
}

export class RoleError extends Error {}

export function requireOwner(roles: readonly Role[], accountId: string): void {
	if ((accountId === 'sender' || accountId === 'receiver') && roles.includes(accountId)) return;
	throw new RoleError(
		`not viewing as the owner of accountId ${accountId} — switch to its owner view first`
	);
}

export function requireAuditor(roles: readonly Role[]): void {
	if (roles.includes('auditor')) return;
	throw new RoleError('not viewing as the auditor — switch the auditor view on first');
}
