<script lang="ts">
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { LayoutDashboard, ShieldCheck, ShieldQuestion, RotateCcw, UserRound } from '@lucide/svelte';
	import { demo } from '$lib/store/demo-store.svelte';
	import { PERSONAS, MINT } from '$lib/entities.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import { shortenAddress } from '$lib/format';
	import { getCopy } from '$lib/i18n';
	import LanguageSwitcher from './LanguageSwitcher.svelte';

	// `userEmail` comes from the platform's SSO gate (see src/hooks.server.ts)
	// and is display-only: it never decides what the viewer may see.
	let { userEmail }: { userEmail: string | null } = $props();
	const c = $derived(getCopy(demo.language));

	const operationsNav = $derived([
		{ href: `${base}/`, routeId: '/', label: c.nav.dashboard, Icon: LayoutDashboard },
		{ href: `${base}/audit`, routeId: '/audit', label: c.nav.audit, Icon: ShieldCheck }
	]);

	const networkLabel = $derived(
		(
			{
				connected: { text: c.common.devnetConnected, dotClass: 'bg-success-500', Icon: ShieldCheck },
				degraded: { text: c.common.devnetDegraded, dotClass: 'bg-warning-500', Icon: ShieldQuestion },
				disconnected: { text: c.common.devnetDisconnected, dotClass: 'bg-danger-500', Icon: ShieldQuestion }
			} as const
		)[demo.network]
	);
	const onAccounts = $derived(page.route.id?.startsWith('/accounts') ?? false);
</script>

<aside class="flex h-screen w-16 shrink-0 flex-col border-r border-border-subtle bg-sidebar xl:w-64">
	<div class="flex items-center gap-2.5 px-3 py-5 xl:px-5">
		<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">CB</div>
		<div class="hidden xl:block">
			<p class="text-sm font-semibold text-ink-900">{c.nav.dashboard}</p>
			<p class="text-xs text-ink-500">{MINT.symbol}</p>
		</div>
	</div>

	<nav class="flex-1 overflow-y-auto px-2 py-2 xl:px-3">
		<p class="hidden px-2 pb-2 pt-3 text-xs font-semibold uppercase tracking-wide text-ink-400 xl:block">{c.nav.operations}</p>
		<ul class="flex flex-col gap-0.5">
			{#each operationsNav as item (item.routeId)}
				{@const active = page.route.id === item.routeId}
				<li>
					<a
						href={item.href}
						aria-current={active ? 'page' : undefined}
						title={item.label}
						class={[
							'flex items-center justify-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors xl:justify-start',
							active ? 'bg-brand-50 text-brand-700' : 'text-ink-700 hover:bg-ink-900/5'
						]}
					>
						<item.Icon size={16} strokeWidth={2.25} />
						<span class="hidden xl:inline">{item.label}</span>
					</a>
				</li>
			{/each}
		</ul>

		<p class="hidden px-2 pb-2 pt-5 text-xs font-semibold uppercase tracking-wide text-ink-400 xl:block">{c.nav.accounts}</p>
		<ul class="flex flex-col gap-0.5">
			{#each PERSONAS as persona (persona.id)}
				{@const active = demo.ownerAccountId === persona.id && onAccounts}
				<li>
					<button
						type="button"
						onclick={() => {
							demo.setOwnerAccountId(persona.id);
							void goto(`${base}/accounts/${persona.id}`);
						}}
						title={persona.name}
						class={[
							'flex w-full items-center justify-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors xl:justify-start',
							active ? 'bg-brand-50' : 'hover:bg-ink-900/5'
						]}
					>
						<Avatar initials={persona.initials} seed={persona.id} size="sm" />
						<span class="hidden min-w-0 flex-1 xl:block">
							<span class="block truncate font-medium text-ink-900">{persona.name}</span>
							<span class="block truncate font-mono text-xs text-ink-400">{shortenAddress(persona.address)}</span>
						</span>
						<span class="hidden shrink-0 rounded-full bg-ink-900/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-ink-500 xl:inline">
							{persona.role === 'sender' ? c.nav.sender : c.nav.receiver}
						</span>
					</button>
				</li>
			{/each}
		</ul>
	</nav>

	<div class="flex flex-col gap-2 border-t border-border-subtle px-2 py-3 xl:px-3">
		<div class="hidden xl:block"><LanguageSwitcher compact /></div>
		<button
			type="button"
			onclick={() => void demo.reset()}
			title={c.nav.refreshFromDevnet}
			class="flex items-center justify-center gap-2 rounded-lg px-2 py-2 text-xs font-medium text-ink-500 hover:bg-ink-900/5 hover:text-ink-700 xl:justify-start"
		>
			<RotateCcw size={14} />
			<span class="hidden xl:inline">{c.nav.refreshFromDevnet}</span>
		</button>
		<div class="flex items-center justify-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-medium text-ink-700 xl:justify-start" title={networkLabel.text}>
			<span class={['h-2 w-2 shrink-0 rounded-full', networkLabel.dotClass]}></span>
			<span class="hidden xl:inline">{networkLabel.text}</span>
		</div>
		{#if userEmail}
			<div class="flex items-center justify-center gap-2 rounded-lg px-2 py-2 text-xs text-ink-500 xl:justify-start" title={userEmail}>
				<UserRound size={14} class="shrink-0" />
				<span class="hidden min-w-0 xl:block">
					<span class="block text-[10px] uppercase tracking-wide text-ink-400">{c.shell.signedInAs}</span>
					<span class="block truncate">{userEmail}</span>
				</span>
			</div>
		{/if}
	</div>
</aside>
