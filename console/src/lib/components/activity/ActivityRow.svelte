<script lang="ts">
	import { ArrowDownLeft, ArrowUpRight, RefreshCw, Lock, Coins, Loader2 } from '@lucide/svelte';
	import type { ActivityEntry, Role } from '$lib/types';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import PrivacyBadge from '$lib/components/ui/PrivacyBadge.svelte';
	import SolscanIconLink from '$lib/components/ui/SolscanIconLink.svelte';
	import { findPersona, MINT } from '$lib/entities.svelte';
	import { formatAmount, formatTimestamp, shortenAddress } from '$lib/format';
	import { canSeeConfidentialAmount } from '$lib/permissions';
	import { getCopy } from '$lib/i18n';
	import { demo } from '$lib/store/demo-store.svelte';

	const TYPE_ICON = {
		mint: Coins,
		deposit: ArrowDownLeft,
		withdraw: ArrowUpRight,
		confidential_transfer: RefreshCw,
		apply_pending: RefreshCw
	};

	let {
		entry,
		role,
		ownerAccountId,
		loading = false
	}: { entry: ActivityEntry; role: Role; ownerAccountId: string; loading?: boolean } = $props();
	const c = $derived(getCopy(demo.language));
	const Icon = $derived(TYPE_ICON[entry.type]);
	const from = $derived(findPersona(entry.fromAccountId));
	const to = $derived(findPersona(entry.toAccountId));
	const canSee = $derived(canSeeConfidentialAmount(entry, role, ownerAccountId));
	const typeLabel = $derived(
		{
			mint: c.activity.mintLabel,
			deposit: c.activity.depositLabel,
			withdraw: c.activity.withdrawLabel,
			confidential_transfer: c.activity.confidentialTransferLabel,
			apply_pending: c.activity.applyPendingLabel
		}[entry.type]
	);
</script>

<div class="flex items-center gap-4 border-b border-border-subtle px-5 py-3 last:border-b-0">
	<span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-canvas text-ink-500">
		<Icon size={15} />
	</span>
	<div class="min-w-0 flex-1">
		<p class="truncate text-sm font-medium text-ink-900">
			{typeLabel}
			{#if entry.type === 'confidential_transfer'}
				<span class="font-normal text-ink-500"> · {from?.name} → {to?.name}</span>
			{/if}
		</p>
		<p class="mt-0.5 truncate font-mono text-xs text-ink-400">
			{shortenAddress(entry.signature, 6)} · {formatTimestamp(entry.timestamp)}
		</p>
	</div>
	<div class="shrink-0 text-right">
		{#if entry.privacy === 'confidential'}
			<!-- Loading wins over an amount already in hand: a transfer's amount
			     may be present from the *other* party's view being on, while this
			     account's own entries still wait for their fetch. -->
			{#if canSee && loading}
				<p aria-busy="true" class="flex items-center justify-end gap-2 text-ink-400">
					<Loader2 size={12} class="animate-spin motion-reduce:animate-none" />
					<span class="h-4 w-16 animate-pulse rounded bg-ink-900/10 motion-reduce:animate-none"></span>
				</p>
			{:else if canSee && entry.partyVisibleAmount != null}
				<p class="text-sm font-semibold text-ink-900">{formatAmount(entry.partyVisibleAmount)} {MINT.symbol}</p>
			{:else}
				<p class="flex items-center justify-end gap-1 text-sm font-medium text-ink-400">
					<Lock size={12} /> {c.common.encrypted}
				</p>
			{/if}
		{:else}
			<p class="text-sm font-semibold text-ink-900">{formatAmount(entry.publicAmount ?? 0)} {MINT.symbol}</p>
		{/if}
	</div>
	<div class="hidden shrink-0 items-center gap-2.5 md:flex">
		<StatusBadge status={entry.status} />
		<PrivacyBadge variant={entry.privacy === 'confidential' ? 'encrypted' : 'public'} />
	</div>
	<SolscanIconLink signature={entry.signature} />
</div>
