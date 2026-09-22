<script lang="ts">
	let { label, value }: { label: string; value: string } = $props();
</script>

<div class="flex items-start justify-between gap-4 py-1.5 text-sm">
	<span class="shrink-0 text-ink-500">{label}</span>
	<span class="text-right font-mono text-xs text-ink-900 break-all">{value}</span>
</div>
