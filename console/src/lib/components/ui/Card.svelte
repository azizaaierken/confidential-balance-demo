<script lang="ts">
	import type { Snippet } from 'svelte';
	let { class: className = '', children }: { class?: string; children: Snippet } = $props();
</script>

<div class={['rounded-2xl border border-border-subtle bg-surface shadow-[0_1px_2px_rgba(20,20,40,0.04)]', className]}>
	{@render children()}
</div>
