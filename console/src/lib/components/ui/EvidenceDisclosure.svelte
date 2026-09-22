<script lang="ts">
	import { ChevronDown, FlaskConical } from '@lucide/svelte';
	import type { Snippet } from 'svelte';

	let { label, children, defaultOpen = false }: { label: string; children: Snippet; defaultOpen?: boolean } = $props();
	// svelte-ignore state_referenced_locally -- the prop is only an initial value by design
	let open = $state(defaultOpen);
</script>

<div class="rounded-xl border border-border-subtle bg-canvas/60">
	<button
		type="button"
		onclick={() => (open = !open)}
		class="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium text-ink-700"
		aria-expanded={open}
	>
		<span class="flex items-center gap-2">
			<FlaskConical size={14} class="text-ink-400" />
			{label}
		</span>
		<ChevronDown size={16} class={['text-ink-400 transition-transform motion-reduce:transition-none', open && 'rotate-180']} />
	</button>
	{#if open}
		<div class="border-t border-border-subtle px-4 py-3">{@render children()}</div>
	{/if}
</div>
