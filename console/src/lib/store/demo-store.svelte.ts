import type {
	AccountBalanceState,
	ActivityEntry,
	AuditDisclosure,
	AuditorKeyGeneration,
	NetworkStatus
} from '$lib/types';
import { hydrateMintAndPersonas, RECEIVER, SENDER } from '$lib/entities.svelte';
import * as backend from '$lib/backend/client';
import type { Locale } from '$lib/i18n';
import { setActiveLocale } from '$lib/locale';

// Switching a role off (or the "Refresh from devnet" reset) takes effect
// immediately — but without this, the previously-decrypted balances/amounts
// already in the store stay exactly as they were until the background
// `hydrate()` finishes its real devnet round trip (a ~1-3s gap): the UI would
// show the public view right next to a still-visible decrypted figure. This
// redacts client-side state to match `roles` in the same tick the switch
// flips, so there's no window where they disagree; `hydrate()` then
// reconfirms it for real.
export function redactForRoles(
	balances: Record<string, AccountBalanceState>,
	activity: ActivityEntry[],
	roles: backend.ViewRoles
): { balances: Record<string, AccountBalanceState>; activity: ActivityEntry[] } {
	const holds = (accountId: string) =>
		(accountId === 'sender' && roles.sender) || (accountId === 'receiver' && roles.receiver);

	const redactedBalances = Object.fromEntries(
		Object.entries(balances).map(([id, b]) =>
			holds(id)
				? [id, b]
				: [
						id,
						{
							...b,
							confidentialAvailable: { ...b.confidentialAvailable, decrypted: null },
							confidentialPending: { ...b.confidentialPending, decrypted: null }
						}
					]
		)
	);

	const redactedActivity = activity.map((a) => {
		const isParty = holds(a.fromAccountId) || holds(a.toAccountId);
		return {
			...a,
			partyVisibleAmount: isParty ? a.partyVisibleAmount : undefined,
			confidential: a.confidential
				? { ...a.confidential, disclosedAmount: roles.auditor ? a.confidential.disclosedAmount : undefined }
				: a.confidential
		};
	});

	return { balances: redactedBalances, activity: redactedActivity };
}

function activeAuditorKeyGeneration(gens: AuditorKeyGeneration[]): AuditorKeyGeneration {
	const active = gens.find((g) => g.status === 'active');
	return active ?? gens[gens.length - 1];
}

// Every read of /api/state is a real devnet round trip, so several can be in
// flight at once — the mount-time hydrate, a view switch, a relock. Without
// ordering, an older request can land *after* a newer one and overwrite it
// with stale visibility. Each read takes a ticket; only the newest ticket's
// result is applied. Action responses (mint, deposit, …) also take a ticket so
// an older plain read can't clobber the post-action state they return.
let latestReadTicket = 0;
function takeReadTicket(): number {
	return ++latestReadTicket;
}
function isLatest(ticket: number): boolean {
	return ticket === latestReadTicket;
}

export class DemoStore {
	ownerAccountId = $state(SENDER.id);
	network = $state<NetworkStatus>('connected');
	language = $state<Locale>('en');
	totalSupply = $state(0);
	balances = $state<Record<string, AccountBalanceState>>({});
	activity = $state<ActivityEntry[]>([]);
	auditorKeyGenerations = $state<AuditorKeyGeneration[]>([]);
	auditDisclosures = $state<AuditDisclosure[]>([]);
	storage = $state<'postgres' | 'memory'>('memory');

	// Which roles the viewer has switched on. Memory-only, so a reload always
	// starts as a public observer. Sent to the server on every request; it
	// redacts confidential fields and disclosure records for whatever is off.
	// A demo switch, not a credential.
	viewRoles = $state<backend.ViewRoles>({ ...backend.NO_ROLES });
	// Roles whose switch is on but whose data has not arrived yet. The UI
	// shows a loading state for those fields instead of the public view's
	// mask, so a switch and its numbers read as one change.
	loadingViewRoles = $state<backend.ViewRoles>({ ...backend.NO_ROLES });

	backendReady = $state(false);
	backendError = $state<string | null>(null);

	get connectedWalletAddress(): string {
		return this.ownerAccountId === SENDER.id ? SENDER.address : RECEIVER.address;
	}

	setOwnerAccountId(id: string) {
		this.ownerAccountId = id;
	}
	setNetwork(status: NetworkStatus) {
		this.network = status;
	}
	setLanguage(language: Locale) {
		setActiveLocale(language);
		this.language = language;
	}

	private applyBackendState(state: backend.BackendState) {
		hydrateMintAndPersonas(state.mint, state.personas);
		this.totalSupply = state.totalSupply;
		this.balances = state.balances;
		this.activity = state.activity;
		this.auditorKeyGenerations = state.auditorKeyGenerations;
		this.auditDisclosures = state.auditDisclosures;
		this.storage = state.storage;
	}

	private redact(roles: backend.ViewRoles) {
		const { balances, activity } = redactForRoles(this.balances, this.activity, roles);
		this.balances = balances;
		this.activity = activity;
	}

	async hydrate(): Promise<void> {
		const ticket = takeReadTicket();
		try {
			const state = await backend.fetchState(this.viewRoles);
			if (!isLatest(ticket)) return;
			this.applyBackendState(state);
			this.backendReady = true;
			this.backendError = null;
			this.network = 'connected';
		} catch (e) {
			if (!isLatest(ticket)) return;
			// Only the first connection gets the full-screen error: once the app
			// has real state on screen, a failed refresh should leave that state
			// up and flag the connection as degraded rather than replace
			// everything with an error page.
			if (this.backendReady) {
				this.network = 'degraded';
			} else {
				this.backendReady = false;
				this.backendError = e instanceof Error ? e.message : String(e);
			}
			throw e;
		}
	}

	async reset(): Promise<void> {
		this.ownerAccountId = SENDER.id;
		this.network = 'connected';
		this.viewRoles = { ...backend.NO_ROLES };
		this.redact(backend.NO_ROLES);
		await this.hydrate();
	}

	async setViewRole(role: backend.ViewRole, on: boolean): Promise<void> {
		const roles = { ...this.viewRoles, [role]: on };
		// Flip the switch immediately so the click has a visible effect. Safe in
		// both directions: switching off redacts client-side state in the same
		// tick, and switching on reveals nothing by itself — confidential fields
		// stay masked until the server's decrypted values arrive, because the UI
		// keys masking off `decrypted === null`, not off the switch.
		this.viewRoles = roles;
		this.loadingViewRoles = { ...this.loadingViewRoles, [role]: on };
		this.redact(roles);
		const ticket = takeReadTicket();
		try {
			const state = await backend.fetchState(roles);
			if (!isLatest(ticket)) return;
			this.applyBackendState(state);
			this.network = 'connected';
		} catch {
			// The switch stays where the user put it and the (still masked) data
			// stays on screen; the sidebar shows the connection as degraded and
			// the next read — a retry click or any action — refreshes it.
			if (!isLatest(ticket)) return;
			this.network = 'degraded';
		} finally {
			this.loadingViewRoles = { ...this.loadingViewRoles, [role]: false };
		}
	}

	private async runAction(
		what: string,
		call: () => Promise<{ signature: string; state: backend.BackendState }>
	): Promise<ActivityEntry> {
		takeReadTicket();
		const { signature, state } = await call();
		this.applyBackendState(state);
		const entry = state.activity.find((a) => a.signature === signature);
		if (!entry) throw new Error(`${what} succeeded but activity entry was not found`);
		return entry;
	}

	mintSupply(accountId: string, amount: number) {
		return this.runAction('mint', () => backend.mintSupply(accountId, amount, this.viewRoles));
	}
	deposit(accountId: string, amount: number) {
		return this.runAction('deposit', () => backend.deposit(accountId, amount, this.viewRoles));
	}
	withdraw(accountId: string, amount: number) {
		return this.runAction('withdraw', () => backend.withdraw(accountId, amount, this.viewRoles));
	}
	confidentialTransfer(fromId: string, toId: string, amount: number) {
		return this.runAction('transfer', () => backend.confidentialTransfer(fromId, toId, amount, this.viewRoles));
	}

	async applyPending(accountId: string): Promise<void> {
		takeReadTicket();
		const { state } = await backend.applyPending(accountId, this.viewRoles);
		this.applyBackendState(state);
	}

	async requestAuditDisclosure(
		activityId: string,
		requestedBy: string,
		reason: string,
		useKeyGenerationId: string
	): Promise<AuditDisclosure> {
		takeReadTicket();
		const { disclosure, state } = await backend.requestAuditDisclosure(
			activityId,
			requestedBy,
			reason,
			useKeyGenerationId,
			this.viewRoles
		);
		this.applyBackendState(state);
		return disclosure;
	}

	async rotateAuditorKey(): Promise<AuditorKeyGeneration> {
		takeReadTicket();
		const state = await backend.rotateAuditorKey(this.viewRoles);
		this.applyBackendState(state);
		return activeAuditorKeyGeneration(state.auditorKeyGenerations);
	}
}

export const demo = new DemoStore();

// Every request reports success/failure here. Once the initial connection
// has succeeded, a later failure means devnet or the server hiccuped, not
// that we're disconnected — "degraded", not "disconnected".
backend.onNetworkStatus((ok) => {
	if (!demo.backendReady) return;
	demo.network = ok ? 'connected' : 'degraded';
});
