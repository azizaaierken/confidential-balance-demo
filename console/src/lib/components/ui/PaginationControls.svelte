<script lang="ts">
	import { ChevronLeft, ChevronRight } from '@lucide/svelte';
	import Button from './Button.svelte';
	import { getCopy } from '$lib/i18n';
	import { demo } from '$lib/store/demo-store.svelte';
	import type { Pagination } from '$lib/pagination.svelte';

	let { pagination }: { pagination: Pagination<unknown> } = $props();
	const c = $derived(getCopy(demo.language));
</script>

<div class="flex items-center justify-between gap-3 border-t border-border-subtle px-5 py-3">
	<Button size="sm" variant="secondary" disabled={!pagination.hasPrev} onclick={pagination.prev}>
		<ChevronLeft size={14} /> {c.common.previousPage}
	</Button>
	<p class="text-xs text-ink-500">{c.common.pageOf(pagination.currentPage + 1, pagination.pageCount)}</p>
	<Button size="sm" variant="secondary" disabled={!pagination.hasNext} onclick={pagination.next}>
		{c.common.nextPage} <ChevronRight size={14} />
	</Button>
</div>
