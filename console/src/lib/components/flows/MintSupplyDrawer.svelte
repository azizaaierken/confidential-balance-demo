<script lang="ts">
	import Drawer from '$lib/components/ui/Drawer.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import WarningNote from '$lib/components/ui/WarningNote.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import EvidenceDisclosure from '$lib/components/ui/EvidenceDisclosure.svelte';
	import EvidenceRow from '$lib/components/ui/EvidenceRow.svelte';
	import SolscanLink from '$lib/components/ui/SolscanLink.svelte';
	import { demo } from '$lib/store/demo-store.svelte';
	import { MINT, PERSONAS } from '$lib/entities.svelte';
	import type { ActivityEntry } from '$lib/types';
	import { formatAmount, shortenAddress } from '$lib/format';
	import { getCopy } from '$lib/i18n';

	let { open, onClose }: { open: boolean; onClose: () => void } = $props();
	const c = $derived(getCopy(demo.language));

	let recipientId = $state(PERSONAS[0].id);
	let amount = $state('');
	let result = $state<ActivityEntry | null>(null);
	let submitting = $state(false);
	let error = $state<string | null>(null);
	const numericAmount = $derived(parseFloat(amount) || 0);

	function handleClose() {
		recipientId = PERSONAS[0].id;
		amount = '';
		result = null;
		error = null;
		onClose();
	}

	async function submit() {
		submitting = true;
		error = null;
		try {
			result = await demo.mintSupply(recipientId, numericAmount);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			submitting = false;
		}
	}
</script>

<Drawer {open} onClose={handleClose} title={c.mint.drawerTitle} subtitle={`${MINT.symbol} · ${MINT.cluster}`}>
	{#snippet footer()}
		{#if result}
			<div class="flex justify-end"><Button onclick={handleClose}>{c.common.done}</Button></div>
		{:else}
			<div class="flex justify-end gap-3">
				<Button variant="secondary" onclick={handleClose}>{c.common.cancel}</Button>
				<Button disabled={numericAmount <= 0 || submitting} onclick={submit}>
					{submitting ? c.common.processing : c.mint.confirmButton}
				</Button>
			</div>
		{/if}
	{/snippet}

	{#if !result}
		<div class="flex flex-col gap-5">
			<WarningNote>{c.mint.warning}</WarningNote>

			<label class="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
				{c.mint.recipientLabel}
				<select
					bind:value={recipientId}
					class="rounded-lg border border-border-strong px-3 py-2.5 text-sm text-ink-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
				>
					{#each PERSONAS as p (p.id)}
						<option value={p.id}>{p.name} · {shortenAddress(p.address)}</option>
					{/each}
				</select>
			</label>

			<label class="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
				{MINT.symbol} {c.mint.amountLabel}
				<input
					bind:value={amount}
					inputmode="decimal"
					placeholder="0.00"
					class="rounded-lg border border-border-strong px-3 py-2.5 text-sm text-ink-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
				/>
			</label>
			{#if error}<p class="text-sm text-danger-600">{error}</p>{/if}
		</div>
	{:else}
		<div class="flex flex-col gap-5">
			<StatusBadge status={result.status} />
			<div class="rounded-xl border border-success-100 bg-success-50 p-4 text-sm text-success-600">{c.mint.resultConfirmed}</div>
			<EvidenceDisclosure label={c.mint.evidenceTitle} defaultOpen>
				<EvidenceRow label={c.evidence.signatureLabel} value={result.signature} />
				<EvidenceRow label={c.depositWithdraw.publicAmountLabel} value={`${formatAmount(result.publicAmount ?? 0)} ${MINT.symbol}`} />
				<EvidenceRow label={c.evidence.programActivityLabel} value={result.programActivity.join(', ')} />
			</EvidenceDisclosure>
			<SolscanLink signature={result.signature} />
		</div>
	{/if}
</Drawer>
