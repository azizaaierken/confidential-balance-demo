<script lang="ts">
	import type { EvidenceStep } from '$lib/types';
	import { shortenAddress } from '$lib/format';
	import { evidenceStepLabel } from '$lib/i18n/helpers';
	import { getCopy } from '$lib/i18n';
	import { demo } from '$lib/store/demo-store.svelte';
	import SolscanIconLink from './SolscanIconLink.svelte';

	// Breakdown of what actually happened on-chain for this operation — a row
	// per instruction, all sharing the one V1 transaction's signature (see
	// evidence-steps.ts), or a row per real transaction for older entries.
	// Solscan only reliably decodes the Token-2022 instruction; the ZK ElGamal
	// Proof program's verify instructions show up there as "Unknown", so this
	// is the one place to see what a transaction actually did.
	let { steps }: { steps: EvidenceStep[] } = $props();
	const c = $derived(getCopy(demo.language));
</script>

{#if steps.length > 0}
	<div class="flex flex-col gap-2">
		<p class="text-xs font-semibold uppercase tracking-wide text-ink-400">{c.evidence.stepsTitle}</p>
		<div class="rounded-lg border border-border-subtle">
			{#each steps as step, i (`${step.label}-${i}`)}
				<div class="flex items-center justify-between gap-3 border-b border-border-subtle px-3 py-2 text-sm last:border-b-0">
					<span class="min-w-0 flex-1 truncate text-ink-700">{evidenceStepLabel(c, step)}</span>
					<span class="shrink-0 font-mono text-xs text-ink-400">{shortenAddress(step.signature, 6)}</span>
					<SolscanIconLink signature={step.signature} />
				</div>
			{/each}
		</div>
		<p class="text-xs text-ink-400">{c.evidence.solscanGap}</p>
	</div>
{/if}
