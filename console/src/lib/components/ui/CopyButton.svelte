<script lang="ts">
	import { Check, Copy } from '@lucide/svelte';
	import { getCopy } from '$lib/i18n';
	import { demo } from '$lib/store/demo-store.svelte';

	// Copies the full, untruncated value — addresses everywhere in this app are
	// shown shortened for readability, but a viewer independently verifying one
	// needs the real thing.
	let { value, class: className = '' }: { value: string; class?: string } = $props();
	const c = $derived(getCopy(demo.language));
	let copied = $state(false);

	async function handleCopy(e: MouseEvent) {
		e.stopPropagation();
		try {
			await navigator.clipboard.writeText(value);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			// Clipboard API unavailable (e.g. insecure context) — nothing to fall back to.
		}
	}
</script>

<button
	type="button"
	onclick={handleCopy}
	title={copied ? c.common.copied : c.common.copyFullAddress}
	aria-label={copied ? c.common.copied : c.common.copyFullAddress}
	class={['inline-flex shrink-0 items-center justify-center rounded-md p-1 text-ink-400 hover:bg-canvas hover:text-ink-700', className]}
>
	{#if copied}<Check size={13} class="text-success-500" />{:else}<Copy size={13} />{/if}
</button>
