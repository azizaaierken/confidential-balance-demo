<script lang="ts">
	import { AlertTriangle } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	let { children }: { children: Snippet } = $props();
</script>

<div class="flex items-start gap-2 rounded-lg border border-warning-100 bg-warning-50 px-3 py-2 text-sm text-warning-600">
	<AlertTriangle size={16} class="mt-0.5 shrink-0" strokeWidth={2.5} />
	<div>{@render children()}</div>
</div>
