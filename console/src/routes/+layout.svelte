<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import type { LayoutData } from './$types';
	import Sidebar from '$lib/components/shell/Sidebar.svelte';
	import { demo } from '$lib/store/demo-store.svelte';
	import { getCopy } from '$lib/i18n';

	const CONNECT_TIMEOUT_MS = 8000;

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
	const c = $derived(getCopy(demo.language));

	let slowConnect = $state(false);
	let attempt = $state(0);

	function tryConnect() {
		slowConnect = false;
		attempt++;
		demo.hydrate().catch(() => {
			// surfaced via demo.backendError below; nothing further to do here
		});
	}

	onMount(tryConnect);

	// Keep <html lang> in step with the UI language.
	$effect(() => {
		document.documentElement.lang = demo.language;
	});

	$effect(() => {
		// `attempt` is read so the timer restarts on every manual retry.
		void attempt;
		if (demo.backendReady || demo.backendError) return;
		const timer = setTimeout(() => (slowConnect = true), CONNECT_TIMEOUT_MS);
		return () => clearTimeout(timer);
	});
</script>

{#if demo.backendError}
	<div class="flex h-screen flex-col items-center justify-center gap-3 bg-canvas px-6 text-center text-sm text-ink-500">
		<p class="font-medium text-danger-600">{c.shell.backendUnreachableTitle}</p>
		<p class="max-w-md">{demo.backendError}</p>
		<p class="max-w-md text-xs text-ink-400">{c.shell.backendStartHint}</p>
		<button type="button" onclick={tryConnect} class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
			{c.common.retryButton}
		</button>
	</div>
{:else if !demo.backendReady}
	<div class="flex h-screen flex-col items-center justify-center gap-3 bg-canvas px-6 text-center text-sm text-ink-500">
		<p>{c.shell.connecting}</p>
		{#if slowConnect}
			<p class="max-w-md text-xs text-ink-400">{c.shell.slowConnect}</p>
			<button
				type="button"
				onclick={tryConnect}
				class="rounded-lg border border-border-strong bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:bg-canvas"
			>
				{c.common.retryButton}
			</button>
		{/if}
	</div>
{:else}
	<div class="flex h-screen overflow-hidden bg-canvas">
		<Sidebar userEmail={data.userEmail} />
		<div class="flex min-w-0 flex-1 flex-col overflow-y-auto">{@render children()}</div>
	</div>
{/if}
