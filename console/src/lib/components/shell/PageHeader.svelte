<script lang="ts">
	import { Wallet } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import { demo } from '$lib/store/demo-store.svelte';
	import { shortenAddress } from '$lib/format';
	import InfoTooltip from '$lib/components/ui/InfoTooltip.svelte';

	let {
		title,
		subtitle,
		actions,
		// The connected-wallet chip only means something on pages where it's
		// actually the signer for something (the account pages). The Main Console
		// never grants owner authority, so it hides this chip.
		showWallet = true,
		// Optional longer explanation, shown on hover/focus instead of
		// permanently occupying page layout.
		infoTooltip
	}: { title: string; subtitle: string; actions?: Snippet; showWallet?: boolean; infoTooltip?: string } = $props();
</script>

<header
	class="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-4 border-b border-border-subtle bg-canvas/90 px-6 py-5 backdrop-blur"
>
	<div>
		<h1 class="text-xl font-semibold text-ink-900">{title}</h1>
		<p class="mt-1 flex items-center gap-1.5 text-sm text-ink-500">
			{subtitle}
			{#if infoTooltip}<InfoTooltip text={infoTooltip} />{/if}
		</p>
	</div>
	<div class="flex items-center gap-3">
		{#if showWallet}
			<span class="hidden items-center gap-2 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-xs font-medium text-ink-700 sm:flex">
				<Wallet size={14} class="text-ink-400" />
				{shortenAddress(demo.connectedWalletAddress)}
			</span>
		{/if}
		{#if actions}{@render actions()}{/if}
	</div>
</header>
