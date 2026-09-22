<script lang="ts">
	import { Eye, Loader2, Unlock } from '@lucide/svelte';
	import { getCopy } from '$lib/i18n';
	import { demo } from '$lib/store/demo-store.svelte';

	// Public observer view is the default for every account; the owner view is
	// switched on per account here. This is the demo's stand-in for the owner
	// connecting their wallet — a UI switch, not authentication.
	let { accountId }: { accountId: 'sender' | 'receiver' } = $props();
	const c = $derived(getCopy(demo.language));
	const isOwner = $derived(demo.viewRoles[accountId]);
	const loading = $derived(demo.loadingViewRoles[accountId]);

	function choose(owner: boolean) {
		if (isOwner === owner || loading) return;
		void demo.setViewRole(accountId, owner);
	}
	const options = $derived([
		{ owner: false, label: c.roleSwitcher.publicView, Icon: Eye },
		{ owner: true, label: c.roleSwitcher.ownerView, Icon: Unlock }
	]);
</script>

<div
	role="radiogroup"
	aria-label={c.roleSwitcher.label}
	title={c.roleSwitcher.demoHint}
	class="inline-flex items-center rounded-lg border border-border-strong bg-white p-1"
>
	{#each options as { owner, label, Icon } (String(owner))}
		<button
			type="button"
			role="radio"
			aria-checked={isOwner === owner}
			onclick={() => choose(owner)}
			aria-busy={loading && isOwner === owner}
			class={[
				'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
				isOwner === owner ? 'bg-brand-600 text-white' : 'text-ink-700 hover:bg-ink-900/5'
			]}
		>
			{#if loading && isOwner === owner}
				<Loader2 size={14} class="animate-spin motion-reduce:animate-none" />
			{:else}
				<Icon size={14} />
			{/if}
			{label}
		</button>
	{/each}
</div>
