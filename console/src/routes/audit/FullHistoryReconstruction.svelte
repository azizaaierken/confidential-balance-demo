<script lang="ts">
	import { History, Lock } from '@lucide/svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import CardHeader from '$lib/components/ui/CardHeader.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import PaginationControls from '$lib/components/ui/PaginationControls.svelte';
	import { Pagination } from '$lib/pagination.svelte';
	import { demo } from '$lib/store/demo-store.svelte';
	import { MINT, PERSONAS } from '$lib/entities.svelte';
	import { formatAmount, formatTimestamp, shortenAddress } from '$lib/format';
	import { getCopy } from '$lib/i18n';

	let { unlocked }: { unlocked: boolean } = $props();
	const c = $derived(getCopy(demo.language));

	let accountId = $state(PERSONAS[0].id);
	let reconstructing = $state(false);
	let progress = $state<{ done: number; total: number } | null>(null);
	let reconstructedFor = $state<string | null>(null);

	const scoped = $derived(
		demo.activity.filter((a) => a.fromAccountId === accountId || a.toAccountId === accountId).sort((a, b) => a.timestamp - b.timestamp)
	);
	// Locking clears the reconstruction outright rather than only hiding it, so
	// re-unlocking can't silently restore a previous result. Reaching it again
	// means running the disclosures again — each one individually logged,
	// which is the point the panel is making.
	$effect(() => {
		if (!unlocked) {
			reconstructedFor = null;
			progress = null;
		}
	});

	const reconstructedEntries = $derived(scoped.filter((entry) => entry.type !== 'apply_pending'));
	const reconstructedPage = new Pagination(() => reconstructedEntries);
	const totalConfidentialTransfers = $derived(scoped.filter((a) => a.type === 'confidential_transfer').length);

	const typeLabel = (type: string) =>
		({
			mint: c.activity.mintLabel,
			deposit: c.activity.depositLabel,
			withdraw: c.activity.withdrawLabel,
			confidential_transfer: c.activity.confidentialTransferLabel,
			apply_pending: c.activity.applyPendingLabel
		})[type] ?? type;

	async function reconstruct() {
		reconstructing = true;
		reconstructedFor = null;
		const undisclosed = scoped.filter(
			(a) => a.type === 'confidential_transfer' && a.confidential && a.confidential.disclosedAmount == null
		);
		progress = { done: 0, total: undisclosed.length };
		try {
			for (let i = 0; i < undisclosed.length; i++) {
				const entry = undisclosed[i];
				await demo.requestAuditDisclosure(entry.id, c.audit.defaultRequestedBy, c.audit.fullHistoryReason, entry.confidential!.auditorKeyGenerationId);
				progress = { done: i + 1, total: undisclosed.length };
			}
			reconstructedFor = accountId;
		} finally {
			reconstructing = false;
		}
	}

	function onAccountChange() {
		reconstructedFor = null;
		progress = null;
	}
</script>

<Card>
	<CardHeader title={c.audit.fullHistoryTitle} subtitle={c.audit.fullHistorySubtitle} />
	<div class="flex flex-col gap-3 px-5 py-5">
		<div class="flex flex-wrap items-center gap-3">
			<label class="flex items-center gap-2 text-sm font-medium text-ink-700">
				{c.audit.fullHistorySelectLabel}
				<select
					bind:value={accountId}
					onchange={onAccountChange}
					class="rounded-lg border border-border-strong bg-white px-3 py-1.5 text-sm font-medium text-ink-900"
				>
					{#each PERSONAS as p (p.id)}
						<option value={p.id}>{p.name}</option>
					{/each}
				</select>
			</label>
			<Button size="sm" variant="secondary" disabled={!unlocked || reconstructing} onclick={reconstruct}>
				<History size={14} />
				{reconstructing ? c.audit.fullHistoryProgress(progress?.done ?? 0, progress?.total ?? 0) : c.audit.fullHistoryReconstructButton}
			</Button>
		</div>

		<!-- Derived from `unlocked`, not just from local state: this block is
		     the product of auditor-authorized disclosures, so re-locking the
		     console has to take it away. -->
		{#if unlocked && reconstructedFor === accountId}
			<div class="flex flex-col gap-3">
				<div class="rounded-xl border border-brand-100 bg-brand-50 p-4 text-sm text-brand-700">
					<p class="font-medium">{c.audit.fullHistoryResultTitle}</p>
					<p class="mt-1 text-brand-700/90">{c.audit.fullHistoryResultNote(totalConfidentialTransfers)}</p>
				</div>
				<div class="rounded-xl border border-border-subtle">
					{#each reconstructedPage.paged as entry (entry.id)}
						<div class="flex items-center justify-between gap-4 border-b border-border-subtle px-4 py-2.5 text-sm last:border-b-0">
							<div class="min-w-0 flex-1">
								<p class="truncate font-medium text-ink-900">{typeLabel(entry.type)}</p>
								<p class="font-mono text-xs text-ink-400">{shortenAddress(entry.signature, 6)} · {formatTimestamp(entry.timestamp)}</p>
							</div>
							{#if entry.confidential && entry.confidential.disclosedAmount == null}
								<!-- Undisclosed (e.g. its key generation could not decrypt it)
								     — falling back to 0.00 would state a figure for something
								     that was never actually revealed. -->
								<p class="flex shrink-0 items-center gap-1 text-sm font-medium text-ink-400"><Lock size={12} /> {c.common.encrypted}</p>
							{:else}
								<p class="shrink-0 text-sm font-semibold text-ink-900">
									{formatAmount(entry.confidential?.disclosedAmount ?? entry.publicAmount ?? 0)} {MINT.symbol}
								</p>
							{/if}
						</div>
					{/each}
					{#if reconstructedPage.showControls}
						<PaginationControls pagination={reconstructedPage} />
					{/if}
				</div>
			</div>
		{/if}
	</div>
</Card>
