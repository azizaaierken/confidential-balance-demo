<script lang="ts">
	import { CircleCheck, CircleX, Clock } from '@lucide/svelte';
	import { getCopy } from '$lib/i18n';
	import { demo } from '$lib/store/demo-store.svelte';

	type StatusVariant = 'confirmed' | 'pending' | 'failed';
	let { status }: { status: StatusVariant } = $props();
	const c = $derived(getCopy(demo.language));

	const ICON = { confirmed: CircleCheck, pending: Clock, failed: CircleX };
	const CLASS: Record<StatusVariant, string> = {
		confirmed: 'text-success-600',
		pending: 'text-warning-600',
		failed: 'text-danger-600'
	};
	const Icon = $derived(ICON[status]);
	const label = $derived({ confirmed: c.common.confirmed, pending: c.common.pending, failed: c.common.failed }[status]);
</script>

<span class={['inline-flex items-center gap-1 text-xs font-medium', CLASS[status]]}>
	<Icon size={12} strokeWidth={2.5} />
	{label}
</span>
