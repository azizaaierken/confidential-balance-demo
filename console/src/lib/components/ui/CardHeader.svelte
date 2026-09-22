<script lang="ts">
	import type { Snippet } from 'svelte';
	let { title, subtitle, action }: { title: string; subtitle?: string; action?: Snippet } = $props();
</script>

<div class="flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
	<div>
		<h3 class="text-sm font-semibold text-ink-900">{title}</h3>
		{#if subtitle}<p class="mt-0.5 text-sm text-ink-500">{subtitle}</p>{/if}
	</div>
	{#if action}{@render action()}{/if}
</div>
