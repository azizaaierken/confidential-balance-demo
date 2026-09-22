<script lang="ts">
	import { base } from '$app/paths';
	import { ArrowDownCircle, ShieldCheck, ArrowRight } from '@lucide/svelte';
	import type { PageData } from './$types';
	import PageHeader from '$lib/components/shell/PageHeader.svelte';
	import RoleSwitcher from '$lib/components/shell/RoleSwitcher.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import CardHeader from '$lib/components/ui/CardHeader.svelte';
	import BalanceRow from '$lib/components/ui/BalanceRow.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import CopyButton from '$lib/components/ui/CopyButton.svelte';
	import ActivityList from '$lib/components/activity/ActivityList.svelte';
	import SendTransferDrawer from '$lib/components/flows/SendTransferDrawer.svelte';
	import DepositWithdrawDrawer from '$lib/components/flows/DepositWithdrawDrawer.svelte';
	import { demo } from '$lib/store/demo-store.svelte';
	import { findPersona, MINT } from '$lib/entities.svelte';
	import { formatAmount, shortenAddress } from '$lib/format';
	import { canSeeAccountConfidentialBalance } from '$lib/permissions';
	import type { Role } from '$lib/types';
	import { getCopy } from '$lib/i18n';

	let { data }: { data: PageData } = $props();
	const c = $derived(getCopy(demo.language));
	const id = $derived(data.id);
	const persona = $derived(findPersona(id)!);

	let sendOpen = $state(false);
	let depositOpen = $state(false);
	let withdrawOpen = $state(false);
	let applying = $state(false);

	// ownerAccountId is separate client state (defaults to the sender on every
	// reload) rather than derived from the URL — sync it here so landing on
	// (or refreshing) this exact account's page always treats you as viewing
	// it, the same way clicking it in the sidebar already does.
	$effect(() => {
		if (demo.ownerAccountId !== id) demo.setOwnerAccountId(id);
	});

	const isOwnerHere = $derived(demo.viewRoles[id]);
	const loadingHere = $derived(demo.loadingViewRoles[id]);
	const role: Role = $derived(isOwnerHere ? 'owner' : 'public');

	// A transfer's amount reaches this session whenever *either* party's view
	// is on — the sender legitimately knows what it sent. Correct as a rule,
	// wrong to render here on the other party's page in public view, where it
	// would read as a leak. Each account's page reveals only what *its* own
	// switch turns on.
	const scopedActivity = $derived(
		demo.activity
			.filter((a) => a.fromAccountId === id || a.toAccountId === id)
			.map((a) => (isOwnerHere ? a : { ...a, partyVisibleAmount: undefined }))
	);

	const bal = $derived(demo.balances[id]);
	// The server only ever sends a decrypted value when this account's owner
	// view is on (see src/lib/server/roles.ts); the check below is the
	// client-side mirror of that, never a substitute for it.
	const canSeeConfidential = $derived(
		canSeeAccountConfidentialBalance(id, role, id) && bal?.confidentialAvailable.decrypted !== null
	);
	const hasPending = $derived((bal?.confidentialPending.decrypted ?? 0) > 0);

	async function handleApply() {
		applying = true;
		try {
			await demo.applyPending(id);
		} finally {
			applying = false;
		}
	}
</script>

<PageHeader title={persona.name} subtitle={c.accountDetail.subtitle(shortenAddress(persona.tokenAccount))}>
	{#snippet actions()}
		<div class="flex items-center gap-3">
			<RoleSwitcher accountId={id} />
			<a href="{base}/audit" class="flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-brand-700">
				<ShieldCheck size={14} />
				{c.dashboard.viewAsAuditor}
				<ArrowRight size={14} />
			</a>
		</div>
	{/snippet}
</PageHeader>

<main class="flex flex-col gap-5 px-6 py-6">
	<div class="flex items-center gap-3">
		<Avatar initials={persona.initials} seed={persona.id} size="lg" />
		<div>
			<p class="text-sm font-semibold text-ink-900">{persona.name}</p>
			<p class="flex items-center gap-1 font-mono text-xs text-ink-400">
				{shortenAddress(persona.address, 6)}
				<CopyButton value={persona.address} />
			</p>
		</div>
		<span class="ml-auto rounded-full bg-canvas px-3 py-1 text-xs font-semibold uppercase text-ink-500">
			{persona.role === 'sender' ? c.nav.sender : c.nav.receiver}
		</span>
	</div>

	<div class="grid grid-cols-1 gap-4 lg:grid-cols-12">
		<Card class="lg:col-span-7">
			<BalanceRow label={c.dashboard.publicBalance} value={formatAmount(bal?.publicBalance ?? 0)} suffix={MINT.symbol} privacy="public" />
			<BalanceRow
				label={c.dashboard.availableConfidential}
				value={formatAmount(bal?.confidentialAvailable.decrypted ?? 0)}
				suffix={MINT.symbol}
				privacy="owner-only"
				locked={!canSeeConfidential}
				loading={isOwnerHere && loadingHere}
			/>
			<BalanceRow
				label={c.dashboard.pendingConfidential}
				value={formatAmount(bal?.confidentialPending.decrypted ?? 0)}
				suffix={MINT.symbol}
				privacy="owner-only"
				locked={!canSeeConfidential}
				loading={isOwnerHere && loadingHere}
				accent="warning"
			/>
		</Card>

		<div class="lg:col-span-5">
			{#if isOwnerHere}
				<div class="flex h-full flex-col gap-3">
					<Button onclick={() => (sendOpen = true)}>{c.dashboard.sendTransfer}</Button>
					<Button variant="secondary" class="capitalize" onclick={() => (depositOpen = true)}>{c.depositWithdraw.depositWord}</Button>
					<Button variant="secondary" class="capitalize" onclick={() => (withdrawOpen = true)}>{c.depositWithdraw.withdrawWord}</Button>
				</div>
			{:else}
				<div class="flex h-full flex-col justify-center rounded-2xl border border-border-subtle bg-surface p-5 text-sm text-ink-500">
					{c.accountDetail.switchToOwnerNote}
				</div>
			{/if}
		</div>
	</div>

	<!-- Only when there is actually something to apply: an owner with a zero
	     pending balance has nothing to do here. -->
	{#if canSeeConfidential && hasPending}
		<div class="flex items-start gap-3 rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-700">
			<ArrowDownCircle size={18} class="mt-0.5 shrink-0" />
			<div>
				<p class="font-medium">{c.accountDetail.applyPendingNote}</p>
				<p class="mt-0.5 text-brand-700/90">{c.accountDetail.applyPendingDetail}</p>
			</div>
			<Button size="sm" class="ml-auto shrink-0" disabled={applying} onclick={handleApply}>
				{applying ? c.accountDetail.applying : c.accountDetail.applyButton(formatAmount(bal?.confidentialPending.decrypted ?? 0), MINT.symbol)}
			</Button>
		</div>
	{/if}

	<Card>
		<CardHeader title={c.accountDetail.activityTitle} subtitle={c.accountDetail.activitySubtitle} />
		<ActivityList entries={scopedActivity} {role} ownerAccountId={id} loading={isOwnerHere && loadingHere} />
	</Card>
</main>

<SendTransferDrawer open={sendOpen} onClose={() => (sendOpen = false)} fromAccountId={id} />
<DepositWithdrawDrawer open={depositOpen} onClose={() => (depositOpen = false)} accountId={id} direction="deposit" />
<DepositWithdrawDrawer open={withdrawOpen} onClose={() => (withdrawOpen = false)} accountId={id} direction="withdraw" />
