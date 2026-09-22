<script lang="ts">
	import { LOCALE_LABELS, getCopy, type Locale } from '$lib/i18n';
	import { demo } from '$lib/store/demo-store.svelte';

	const LOCALES: Locale[] = ['en', 'zh-Hans', 'zh-Hant'];
	let { compact = false }: { compact?: boolean } = $props();
	const c = $derived(getCopy(demo.language));
</script>

<div
	role="tablist"
	aria-label={c.languageSwitcher.label}
	class={['inline-flex items-center rounded-lg border border-border-strong bg-white p-0.5', compact && 'w-full justify-between']}
>
	{#each LOCALES as loc (loc)}
		<button
			type="button"
			role="tab"
			aria-selected={demo.language === loc}
			onclick={() => demo.setLanguage(loc)}
			class={[
				'rounded-md px-2 py-1 text-xs font-semibold transition-colors',
				compact && 'flex-1',
				demo.language === loc ? 'bg-brand-600 text-white' : 'text-ink-500 hover:bg-ink-900/5'
			]}
		>
			{LOCALE_LABELS[loc]}
		</button>
	{/each}
</div>
