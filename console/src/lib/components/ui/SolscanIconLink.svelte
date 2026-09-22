<script lang="ts">
	import { ExternalLink } from '@lucide/svelte';
	import { getCopy } from '$lib/i18n';
	import { demo } from '$lib/store/demo-store.svelte';
	import { solscanHref } from './solscan';

	let { signature, address }: { signature?: string; address?: string } = $props();
	const c = $derived(getCopy(demo.language));
	const href = $derived(solscanHref(signature, address));
</script>

{#if !href}
	<button
		type="button"
		disabled
		title={c.common.solscanDisabledHint}
		aria-label={c.common.openInSolscan}
		class="inline-flex shrink-0 items-center justify-center rounded-md p-1.5 text-ink-400 disabled:cursor-not-allowed"
	>
		<ExternalLink size={14} />
	</button>
{:else}
	<a
		{href}
		target="_blank"
		rel="noreferrer"
		title={c.common.openInSolscan}
		aria-label={c.common.openInSolscan}
		class="inline-flex shrink-0 items-center justify-center rounded-md p-1.5 text-ink-400 hover:bg-canvas hover:text-ink-700"
	>
		<ExternalLink size={14} />
	</a>
{/if}
