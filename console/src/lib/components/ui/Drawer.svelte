<script lang="ts">
	import { X } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import { getCopy } from '$lib/i18n';
	import { demo } from '$lib/store/demo-store.svelte';

	let {
		open,
		onClose,
		title,
		subtitle,
		children,
		footer
	}: { open: boolean; onClose: () => void; title: string; subtitle?: string; children: Snippet; footer?: Snippet } =
		$props();
	const c = $derived(getCopy(demo.language));

	function onKey(e: KeyboardEvent) {
		if (open && e.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={onKey} />

{#if open}
	<div class="fixed inset-0 z-50 flex justify-end">
		<div class="absolute inset-0 bg-ink-900/30" onclick={onClose} aria-hidden="true"></div>
		<div role="dialog" aria-modal="true" aria-label={title} class="relative flex h-full w-full max-w-lg flex-col bg-surface shadow-2xl">
			<div class="flex items-start justify-between gap-4 border-b border-border-subtle px-6 py-5">
				<div>
					<h2 class="text-base font-semibold text-ink-900">{title}</h2>
					{#if subtitle}<p class="mt-1 text-sm text-ink-500">{subtitle}</p>{/if}
				</div>
				<button
					type="button"
					onclick={onClose}
					aria-label={c.common.close}
					class="rounded-lg p-1.5 text-ink-500 hover:bg-ink-900/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
				>
					<X size={18} />
				</button>
			</div>
			<div class="flex-1 overflow-y-auto px-6 py-5">{@render children()}</div>
			{#if footer}
				<div class="border-t border-border-subtle px-6 py-4">{@render footer()}</div>
			{/if}
		</div>
	</div>
{/if}
