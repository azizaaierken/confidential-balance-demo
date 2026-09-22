<script lang="ts">
	import Drawer from '$lib/components/ui/Drawer.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import WarningNote from '$lib/components/ui/WarningNote.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import EvidenceDisclosure from '$lib/components/ui/EvidenceDisclosure.svelte';
	import EvidenceRow from '$lib/components/ui/EvidenceRow.svelte';
	import EvidenceSteps from '$lib/components/ui/EvidenceSteps.svelte';
	import { expandEvidenceSteps } from '$lib/components/ui/evidence-steps';
	import SolscanLink from '$lib/components/ui/SolscanLink.svelte';
	import { demo } from '$lib/store/demo-store.svelte';
	import { MINT } from '$lib/entities.svelte';
	import type { ActivityEntry } from '$lib/types';
	import { formatAmount } from '$lib/format';
	import { getCopy } from '$lib/i18n';

	let {
		open,
		onClose,
		accountId,
		direction
	}: { open: boolean; onClose: () => void; accountId: string; direction: 'deposit' | 'withdraw' } = $props();
	const c = $derived(getCopy(demo.language));

	let amount = $state('');
	let result = $state<ActivityEntry | null>(null);
	let submitting = $state(false);
	let error = $state<string | null>(null);

	const bal = $derived(demo.balances[accountId]);
	const source = $derived(direction === 'deposit' ? (bal?.publicBalance ?? 0) : (bal?.confidentialAvailable.decrypted ?? 0));
	const numericAmount = $derived(parseFloat(amount) || 0);
	const insufficient = $derived(numericAmount > source);
	const directionWord = $derived(direction === 'deposit' ? c.depositWithdraw.depositWord : c.depositWithdraw.withdrawWord);
	const title = $derived(direction === 'deposit' ? c.depositWithdraw.depositTitle : c.depositWithdraw.withdrawTitle);

	function capitalize(s: string) {
		return s.charAt(0).toUpperCase() + s.slice(1);
	}

	function handleClose() {
		amount = '';
		result = null;
		error = null;
		onClose();
	}

	async function submit() {
		submitting = true;
		error = null;
		try {
			result =
				direction === 'deposit' ? await demo.deposit(accountId, numericAmount) : await demo.withdraw(accountId, numericAmount);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			submitting = false;
		}
	}
</script>

<Drawer {open} onClose={handleClose} {title} subtitle={`${MINT.symbol} · ${MINT.cluster}`}>
	{#snippet footer()}
		{#if result}
			<div class="flex justify-end"><Button onclick={handleClose}>{c.common.done}</Button></div>
		{:else}
			<div class="flex justify-end gap-3">
				<Button variant="secondary" onclick={handleClose}>{c.common.cancel}</Button>
				<Button disabled={numericAmount <= 0 || insufficient || submitting} onclick={submit} class="capitalize">
					{submitting ? c.common.processing : c.depositWithdraw.confirm(directionWord)}
				</Button>
			</div>
		{/if}
	{/snippet}

	{#if !result}
		<div class="flex flex-col gap-5">
			<WarningNote>{direction === 'deposit' ? c.depositWithdraw.depositWarning : c.depositWithdraw.withdrawWarning}</WarningNote>

			<label class="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
				{MINT.symbol} {c.depositWithdraw.amountLabel}
				<input
					bind:value={amount}
					inputmode="decimal"
					placeholder="0.00"
					class="rounded-lg border border-border-strong px-3 py-2.5 text-sm text-ink-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
				/>
				<span class="text-xs font-normal text-ink-500">
					{direction === 'deposit' ? c.depositWithdraw.sourcePublic : c.depositWithdraw.sourceConfidential}: {formatAmount(source)} {MINT.symbol}
				</span>
			</label>
			{#if insufficient}<p class="text-sm text-danger-600">{c.depositWithdraw.insufficientNote}</p>{/if}
			{#if error}<p class="text-sm text-danger-600">{error}</p>{/if}
		</div>
	{:else}
		<div class="flex flex-col gap-5">
			<StatusBadge status={result.status} />
			<div class="rounded-xl border border-success-100 bg-success-50 p-4 text-sm text-success-600">
				{c.depositWithdraw.resultConfirmed(capitalize(directionWord))}
			</div>
			<EvidenceDisclosure label={c.depositWithdraw.evidenceTitle} defaultOpen>
				<EvidenceRow label={c.evidence.signatureLabel} value={result.signature} />
				<EvidenceRow label={c.depositWithdraw.publicAmountLabel} value={`${formatAmount(result.publicAmount ?? 0)} ${MINT.symbol}`} />
				<EvidenceRow label={c.evidence.programActivityLabel} value={result.programActivity.join(', ')} />
			</EvidenceDisclosure>
			<EvidenceSteps steps={direction === 'withdraw' ? expandEvidenceSteps(result.steps, 'withdraw') : result.steps} />
			<SolscanLink signature={result.signature} />
		</div>
	{/if}
</Drawer>
