<script lang="ts">
	import type { ActivityEntry, Role } from '$lib/types';
	import { Pagination } from '$lib/pagination.svelte';
	import PaginationControls from '$lib/components/ui/PaginationControls.svelte';
	import ActivityRow from './ActivityRow.svelte';
	import { getCopy } from '$lib/i18n';
	import { demo } from '$lib/store/demo-store.svelte';

	let {
		entries,
		role,
		ownerAccountId,
		// Owner view is on but its amounts have not arrived yet.
		loading = false
	}: { entries: ActivityEntry[]; role: Role; ownerAccountId: string; loading?: boolean } = $props();
	const c = $derived(getCopy(demo.language));
	const pagination = new Pagination(() => entries);
</script>

{#if entries.length === 0}
	<p class="px-5 py-8 text-center text-sm text-ink-500">{c.activity.emptyLabel}</p>
{:else}
	<div>
		{#each pagination.paged as entry (entry.id)}
			<ActivityRow {entry} {role} {ownerAccountId} {loading} />
		{/each}
		{#if pagination.showControls}
			<PaginationControls {pagination} />
		{/if}
	</div>
{/if}
