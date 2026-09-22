<script lang="ts">
	import { Loader2, Lock } from '@lucide/svelte';
	import PrivacyBadge, { type PrivacyBadgeVariant } from './PrivacyBadge.svelte';

	let {
		label,
		value,
		suffix,
		privacy,
		locked = false,
		// The owner view is on but its decrypted value has not arrived yet —
		// distinct from `locked`, which is the public view's deliberate mask.
		loading = false,
		accent = 'neutral'
	}: {
		label: string;
		value: string;
		suffix?: string;
		privacy: PrivacyBadgeVariant;
		locked?: boolean;
		loading?: boolean;
		accent?: 'neutral' | 'warning';
	} = $props();
</script>

<div class="flex items-center justify-between gap-4 border-b border-border-subtle px-5 py-4 last:border-b-0">
	<div class="flex items-center gap-2">
		<span class="text-sm font-medium text-ink-500">{label}</span>
		<PrivacyBadge variant={privacy} />
	</div>
	{#if loading}
		<span aria-busy="true" class="flex items-center gap-2 text-ink-400">
			<Loader2 size={14} class="animate-spin motion-reduce:animate-none" />
			<span class="h-5 w-24 animate-pulse rounded bg-ink-900/10 motion-reduce:animate-none"></span>
		</span>
	{:else if locked}
		<span class="flex items-center gap-1.5 font-mono text-lg text-ink-400">
			<Lock size={14} />
			••••••
		</span>
	{:else}
		<span class={['text-xl font-semibold tracking-tight', accent === 'warning' ? 'text-warning-600' : 'text-ink-900']}>
			{value}
			{#if suffix}<span class="ml-1.5 text-sm font-medium text-ink-400">{suffix}</span>{/if}
		</span>
	{/if}
</div>
