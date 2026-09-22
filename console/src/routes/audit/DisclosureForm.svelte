<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import type { AuditorKeyGeneration } from '$lib/types';
	import { MINT } from '$lib/entities.svelte';
	import { formatAmount, formatTimestamp } from '$lib/format';
	import { getCopy } from '$lib/i18n';
	import { demo } from '$lib/store/demo-store.svelte';

	let {
		activityId,
		defaultKeyGenerationId,
		keyGenerations,
		onSubmit
	}: {
		activityId: string;
		defaultKeyGenerationId: string;
		keyGenerations: AuditorKeyGeneration[];
		onSubmit: (requestedBy: string, reason: string, keyGenerationId: string) => Promise<unknown>;
	} = $props();
	const c = $derived(getCopy(demo.language));

	let requestedBy = $state(getCopy(demo.language).audit.defaultRequestedBy);
	let reason = $state('');
	// svelte-ignore state_referenced_locally -- the prop is only an initial value by design
	let keyGenerationId = $state(defaultKeyGenerationId);
	let submitted = $state(false);
	let submitting = $state(false);

	const latest = $derived(demo.auditDisclosures.find((d) => d.activityId === activityId));

	async function submit() {
		submitting = true;
		try {
			await onSubmit(requestedBy, reason, keyGenerationId);
			submitted = true;
		} finally {
			submitting = false;
		}
	}
</script>

<div class="border-t border-border-subtle bg-canvas/40 px-5 py-4">
	{#if !submitted || !latest}
		<div class="flex flex-col gap-3">
			<label class="flex flex-col gap-1 text-xs font-medium text-ink-700">
				{c.audit.requestedByLabel}
				<input bind:value={requestedBy} class="rounded-lg border border-border-strong px-3 py-2 text-sm" />
			</label>
			<label class="flex flex-col gap-1 text-xs font-medium text-ink-700">
				{c.audit.reasonLabel}
				<input bind:value={reason} placeholder={c.audit.reasonPlaceholder} class="rounded-lg border border-border-strong px-3 py-2 text-sm" />
			</label>
			<label class="flex flex-col gap-1 text-xs font-medium text-ink-700">
				{c.audit.keyGenerationLabel}
				<select bind:value={keyGenerationId} class="rounded-lg border border-border-strong px-3 py-2 text-sm">
					{#each keyGenerations as g (g.id)}
						<option value={g.id}>{c.audit.keyGenLabel(g.generation)}</option>
					{/each}
				</select>
			</label>
			<Button size="sm" disabled={!reason.trim() || submitting} onclick={submit}>
				{submitting ? c.common.processing : c.audit.decryptButton}
			</Button>
		</div>
	{:else if latest.outcome === 'success'}
		<div class="rounded-lg border border-brand-100 bg-brand-50 p-3 text-sm text-brand-700">
			{c.audit.decryptedAmountResult(`${formatAmount(latest.decryptedAmount)} ${MINT.symbol}`, latest.requestedBy, formatTimestamp(latest.timestamp))}
		</div>
	{:else}
		<div class="rounded-lg border border-danger-100 bg-danger-50 p-3 text-sm text-danger-600">{c.audit.wrongKeyResult}</div>
	{/if}
</div>
