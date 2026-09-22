<script lang="ts">
	import { ShieldCheck, History } from '@lucide/svelte';
	import PageHeader from '$lib/components/shell/PageHeader.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import CardHeader from '$lib/components/ui/CardHeader.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import CiphertextChip from '$lib/components/ui/CiphertextChip.svelte';
	import SolscanIconLink from '$lib/components/ui/SolscanIconLink.svelte';
	import EvidenceSteps from '$lib/components/ui/EvidenceSteps.svelte';
	import PaginationControls from '$lib/components/ui/PaginationControls.svelte';
	import { Pagination } from '$lib/pagination.svelte';
	import { demo } from '$lib/store/demo-store.svelte';
	import { findPersona, MINT } from '$lib/entities.svelte';
	import { formatAmount, formatTimestamp, shortenAddress } from '$lib/format';
	import { getCopy } from '$lib/i18n';
	import KeyTimeline from './KeyTimeline.svelte';
	import DisclosureForm from './DisclosureForm.svelte';
	import FullHistoryReconstruction from './FullHistoryReconstruction.svelte';

	const c = $derived(getCopy(demo.language));
	const unlocked = $derived(demo.viewRoles.auditor);
	let switching = $state(false);
	let expandedId = $state<string | null>(null);

	async function toggleAuditorView() {
		switching = true;
		try {
			await demo.setViewRole('auditor', !unlocked);
		} finally {
			switching = false;
		}
	}

	const confidentialTransfers = $derived(demo.activity.filter((a) => a.type === 'confidential_transfer'));
	const transfersPage = new Pagination(() => confidentialTransfers);

	const operationalLog = $derived.by(() => {
		const disclosureEvents = demo.auditDisclosures.map((d) => ({
			id: d.id,
			timestamp: d.timestamp,
			text:
				d.outcome === 'success'
					? c.audit.logDisclosed(
							d.requestedBy,
							d.activityId.slice(0, 8),
							c.audit.keyGenLabel(demo.auditorKeyGenerations.find((g) => g.id === d.keyGenerationId)?.generation ?? 0),
							d.reason
						)
					: c.audit.logWrongKey(d.requestedBy, d.activityId.slice(0, 8))
		}));
		const rotationEvents = demo.auditorKeyGenerations.map((g) => ({
			id: `rotation-${g.id}`,
			timestamp: g.createdAt,
			text: c.audit.logKeyActivated(c.audit.keyGenLabel(g.generation), g.status === 'active')
		}));
		return [...disclosureEvents, ...rotationEvents].sort((a, b) => b.timestamp - a.timestamp);
	});
	const accessLogPage = new Pagination(() => operationalLog);
</script>

<PageHeader title={c.audit.title} subtitle={c.audit.subtitle} showWallet={false}>
	{#snippet actions()}
		<!-- The demo's stand-in for the auditor's own authenticated session: a
		     plain switch, defaulting to off. Everything below is redacted by the
		     server until it is on. -->
		<label class="flex cursor-pointer items-center gap-3 text-sm font-medium text-ink-700" title={c.audit.auditorViewHint}>
			<span class="flex items-center gap-1.5">
				<ShieldCheck size={14} class={unlocked ? 'text-brand-600' : 'text-ink-400'} />
				{c.audit.auditorViewLabel}
			</span>
			<button
				type="button"
				role="switch"
				aria-checked={unlocked}
				aria-label={c.audit.auditorViewLabel}
				disabled={switching}
				onclick={toggleAuditorView}
				class={['relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60', unlocked ? 'bg-brand-600' : 'bg-ink-900/15']}
			>
				<span
					class={['absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', unlocked ? 'translate-x-5' : 'translate-x-0']}
				></span>
			</button>
		</label>
	{/snippet}
</PageHeader>

<main class="flex flex-col gap-5 px-6 py-6">
	{#if !unlocked}
		<p class="rounded-xl border border-border-subtle bg-canvas/60 px-4 py-3 text-sm text-ink-500">{c.audit.auditorViewOffNote}</p>
	{/if}

	<KeyTimeline generations={demo.auditorKeyGenerations} {unlocked} onRotate={() => demo.rotateAuditorKey()} />

	<Card>
		<CardHeader title={c.audit.transfersTitle} subtitle={unlocked ? c.audit.transfersSubtitleUnlocked : c.audit.transfersSubtitleLocked} />
		<div>
			{#each transfersPage.paged as entry (entry.id)}
				{@const from = findPersona(entry.fromAccountId)}
				{@const to = findPersona(entry.toAccountId)}
				{@const gen = demo.auditorKeyGenerations.find((g) => g.id === entry.confidential?.auditorKeyGenerationId)}
				{@const expanded = expandedId === entry.id}
				<div class="border-b border-border-subtle last:border-b-0">
					<div class="flex items-center gap-4 px-5 py-3.5">
						<span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-canvas text-ink-500"><ShieldCheck size={16} /></span>
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm font-medium text-ink-900">{from?.name} → {to?.name}</p>
							<p class="font-mono text-xs text-ink-400">
								{shortenAddress(entry.signature, 6)} · {formatTimestamp(entry.timestamp)} · {gen ? c.audit.keyGenLabel(gen.generation) : ''}
							</p>
						</div>
						<div class="shrink-0 text-right">
							{#if entry.confidential?.disclosedAmount != null}
								<p class="text-sm font-semibold text-ink-900">{formatAmount(entry.confidential.disclosedAmount)} {MINT.symbol}</p>
							{:else}
								<CiphertextChip ciphertext={entry.confidential?.ciphertext ?? ''} />
							{/if}
						</div>
						<Button size="sm" variant="secondary" disabled={!unlocked} onclick={() => (expandedId = expanded ? null : entry.id)}>
							{expanded ? c.audit.closeButton : c.audit.requestDisclosure}
						</Button>
						<SolscanIconLink signature={entry.signature} />
					</div>
					{#if expanded && entry.confidential}
						{#if entry.steps.length > 1}
							<div class="border-t border-border-subtle bg-canvas/40 px-5 py-4"><EvidenceSteps steps={entry.steps} /></div>
						{/if}
						<DisclosureForm
							activityId={entry.id}
							defaultKeyGenerationId={entry.confidential.auditorKeyGenerationId}
							keyGenerations={demo.auditorKeyGenerations}
							onSubmit={(requestedBy, reason, keyGenerationId) => demo.requestAuditDisclosure(entry.id, requestedBy, reason, keyGenerationId)}
						/>
					{/if}
				</div>
			{/each}
		</div>
		{#if transfersPage.showControls}
			<PaginationControls pagination={transfersPage} />
		{/if}
	</Card>

	<FullHistoryReconstruction {unlocked} />

	<Card>
		<CardHeader title={c.audit.accessRecordTitle} subtitle={c.audit.accessRecordSubtitle} />
		<div class="flex flex-col gap-0">
			{#if operationalLog.length === 0}
				<p class="px-5 py-6 text-center text-sm text-ink-500">{c.audit.accessRecordEmpty}</p>
			{/if}
			{#each accessLogPage.paged as event (event.id)}
				<div class="flex items-start gap-3 border-b border-border-subtle px-5 py-3 text-sm last:border-b-0">
					<History size={14} class="mt-0.5 shrink-0 text-ink-400" />
					<p class="text-ink-700">{event.text}</p>
					<span class="ml-auto shrink-0 text-xs text-ink-400">{formatTimestamp(event.timestamp)}</span>
				</div>
			{/each}
		</div>
		{#if accessLogPage.showControls}
			<PaginationControls pagination={accessLogPage} />
		{/if}
	</Card>
</main>
