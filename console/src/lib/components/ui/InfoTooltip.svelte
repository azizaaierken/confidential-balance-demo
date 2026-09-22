<script lang="ts">
	import { Info } from '@lucide/svelte';
	// Icon-only trigger, revealed on hover or keyboard focus so explanatory
	// copy doesn't have to permanently occupy page layout.
	let { text }: { text: string } = $props();
</script>

<span class="group relative inline-flex">
	<button
		type="button"
		aria-label={text}
		class="inline-flex h-4 w-4 items-center justify-center rounded-full text-ink-400 hover:text-ink-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
	>
		<Info size={14} />
	</button>
	<span
		role="tooltip"
		class="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-72 -translate-x-1/2 rounded-lg border border-border-subtle bg-ink-900 px-3 py-2 text-xs leading-relaxed text-white opacity-0 shadow-lg transition-opacity motion-reduce:transition-none group-hover:opacity-100 group-focus-within:opacity-100"
	>
		{text}
	</span>
</span>
