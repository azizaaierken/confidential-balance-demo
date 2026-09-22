<script lang="ts">
	import { ExternalLink } from '@lucide/svelte';
	import Button from './Button.svelte';
	import { getCopy } from '$lib/i18n';
	import { demo } from '$lib/store/demo-store.svelte';
	import { solscanHref } from './solscan';

	// With a signature/address, a real devnet Solscan link. Without one, a
	// disabled, tooltipped placeholder rather than a link to nothing.
	let { size = 'md', signature, address }: { size?: 'sm' | 'md'; signature?: string; address?: string } = $props();
	const c = $derived(getCopy(demo.language));
	const href = $derived(solscanHref(signature, address));
</script>

{#if !href}
	<Button variant="ghost" {size} disabled title={c.common.solscanDisabledHint}>
		<ExternalLink size={14} /> {c.common.openInSolscan}
	</Button>
{:else}
	<a
		{href}
		target="_blank"
		rel="noreferrer"
		class={[
			'inline-flex items-center justify-center gap-2 rounded-lg bg-transparent font-medium text-ink-700 transition-colors hover:bg-ink-900/5',
			size === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-4 py-2.5 text-sm'
		]}
	>
		<ExternalLink size={14} /> {c.common.openInSolscan}
	</a>
{/if}
