<script lang="ts">
	import { base } from '$app/paths';
	import { Coins, RefreshCw, KeyRound } from '@lucide/svelte';
	import PageHeader from '$lib/components/shell/PageHeader.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import CardHeader from '$lib/components/ui/CardHeader.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import PrivacyBadge from '$lib/components/ui/PrivacyBadge.svelte';
	import EvidenceDisclosure from '$lib/components/ui/EvidenceDisclosure.svelte';
	import ActivityList from '$lib/components/activity/ActivityList.svelte';
	import MintSupplyDrawer from '$lib/components/flows/MintSupplyDrawer.svelte';
	import SolscanIconLink from '$lib/components/ui/SolscanIconLink.svelte';
	import CopyButton from '$lib/components/ui/CopyButton.svelte';
	import { demo } from '$lib/store/demo-store.svelte';
	import { PERSONAS, MINT } from '$lib/entities.svelte';
	import { formatAmount, shortenAddress } from '$lib/format';
	import { getCopy } from '$lib/i18n';

	// The Console never grants owner authority — it's a permanent public-observer
	// overview across every account. Becoming an account's owner only happens by
	// selecting it in the sidebar, which lands on that account's own detail page.
	const CONSOLE_ROLE = 'public' as const;

	const c = $derived(getCopy(demo.language));
	let mintOpen = $state(false);
	const activeAuditorKey = $derived(demo.auditorKeyGenerations.find((g) => g.status === 'active'));
	const confidentialTransferCount = $derived(demo.activity.filter((a) => a.type === 'confidential_transfer').length);

	const stats = $derived([
		{ Icon: RefreshCw, label: c.dashboard.statConfidentialTransfers, value: String(confidentialTransferCount) },
		{ Icon: Coins, label: c.dashboard.statTotalSupply, value: `${formatAmount(demo.totalSupply)} ${MINT.symbol}` },
		{ Icon: KeyRound, label: c.dashboard.statActiveAuditorKey, value: activeAuditorKey ? c.audit.keyGenLabel(activeAuditorKey.generation) : '—' }
	]);
</script>

<PageHeader
	title={c.dashboard.title}
	subtitle={c.dashboard.subtitle}
	showWallet={false}
	infoTooltip={`${c.dashboard.thirdPartyQueryNote} ${c.dashboard.ownerAccessHint}`}
/>

<main class="flex flex-col gap-5 px-6 py-6">
	<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
		{#each stats as stat (stat.label)}
			<div class="flex items-center gap-3 rounded-2xl border border-border-subtle bg-surface px-5 py-4">
				<span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-canvas text-ink-500">
					<stat.Icon size={16} />
				</span>
				<div class="min-w-0">
					<p class="truncate text-lg font-semibold text-ink-900">{stat.value}</p>
					<p class="truncate text-xs text-ink-500">{stat.label}</p>
				</div>
			</div>
		{/each}
	</div>

	<Card>
		<CardHeader title={c.mint.configTitle} subtitle={c.mint.configSubtitle}>
			{#snippet action()}
				<Button size="sm" onclick={() => (mintOpen = true)}><Coins size={14} /> {c.mint.mintActionButton}</Button>
			{/snippet}
		</CardHeader>
		<div class="px-5 py-4">
			<EvidenceDisclosure label={c.mint.technicalEvidenceLabel}>
				<div class="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
					<div class="flex flex-col gap-4">
						<div>
							<p class="text-ink-500">{c.mint.mintAddressLabel}</p>
							<p class="flex items-center gap-1 font-mono text-sm text-ink-900">
								{shortenAddress(MINT.address)}
								<SolscanIconLink address={MINT.address} />
							</p>
						</div>
						<div>
							<p class="text-ink-500">{c.mint.assetLabel}</p>
							<p class="font-medium text-ink-900">{MINT.symbol} / {MINT.decimals}</p>
						</div>
						<div>
							<p class="text-ink-500">{c.mint.extensionsLabel}</p>
							<p class="font-medium text-ink-900">{MINT.extensions.join(', ')}</p>
						</div>
						<div>
							<p class="text-ink-500">{c.mint.authorityLabel}</p>
							<p class="font-mono text-sm text-ink-900">{shortenAddress(MINT.confidentialTransferAuthority)}</p>
						</div>
					</div>
					<div class="flex flex-col gap-4">
						<div>
							<p class="text-ink-500">{c.mint.supplyLabel}</p>
							<p class="font-medium text-ink-900">{formatAmount(demo.totalSupply)} {MINT.symbol}</p>
						</div>
						<div>
							<p class="text-ink-500">{c.mint.programLabel}</p>
							<p class="font-mono text-sm text-ink-900">{shortenAddress(MINT.programId)}</p>
						</div>
						<div>
							<p class="text-ink-500">{c.mint.autoApproveLabel}</p>
							<p class="font-medium text-ink-900">{MINT.autoApproveNewAccounts ? c.mint.enabled : c.mint.disabled}</p>
						</div>
						{#if activeAuditorKey}
							<div>
								<p class="text-ink-500">{c.mint.auditorPubkeyLabel}</p>
								<p class="font-mono text-sm text-ink-900">
									{c.audit.keyGenLabel(activeAuditorKey.generation)} · {shortenAddress(activeAuditorKey.elgamalPubkey)}
								</p>
							</div>
						{/if}
					</div>
				</div>
			</EvidenceDisclosure>
		</div>
	</Card>

	<div class="grid grid-cols-1 gap-4 xl:grid-cols-5">
		<Card class="xl:col-span-2">
			<CardHeader title={c.dashboard.accountsPanelTitle} subtitle={c.dashboard.accountsPanelSubtitle} />
			<div>
				{#each PERSONAS as p (p.id)}
					{@const pb = demo.balances[p.id]}
					<div class="flex w-full items-center gap-4 border-b border-border-subtle px-5 py-4 last:border-b-0 hover:bg-canvas/60">
						<Avatar initials={p.initials} seed={p.id} />
						<div class="flex min-w-0 flex-1 flex-col gap-1">
							<a href="{base}/accounts/{p.id}" class="truncate text-sm font-medium leading-5 text-ink-900 hover:text-brand-700">{p.name}</a>
							<!-- The copy control sits on the line it copies. -->
							<span class="flex items-center gap-1 font-mono text-xs leading-5 text-ink-400">
								<span class="truncate">{shortenAddress(p.address)}</span>
								<CopyButton value={p.address} class="-my-1" />
							</span>
						</div>
						<a href="{base}/accounts/{p.id}" class="flex shrink-0 flex-col items-end gap-1 text-right">
							<span class="text-sm font-semibold leading-5 text-ink-900">{formatAmount(pb?.publicBalance ?? 0)} {MINT.symbol}</span>
							<span class="flex h-5 items-center"><PrivacyBadge variant="public" /></span>
						</a>
					</div>
				{/each}
			</div>
		</Card>

		<Card class="xl:col-span-3">
			<CardHeader title={c.dashboard.recentActivityTitle} subtitle={c.dashboard.recentActivitySubtitle} />
			<ActivityList entries={demo.activity} role={CONSOLE_ROLE} ownerAccountId="" />
		</Card>
	</div>
</main>

<MintSupplyDrawer open={mintOpen} onClose={() => (mintOpen = false)} />
