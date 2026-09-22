<script lang="ts" module>
	export type PrivacyBadgeVariant = 'public' | 'owner-only' | 'encrypted' | 'demo-simulation' | 'on-chain-evidence';
</script>

<script lang="ts">
	import { Eye, Lock, Unlock, FlaskConical, Link2 } from '@lucide/svelte';
	import { getCopy } from '$lib/i18n';
	import { demo } from '$lib/store/demo-store.svelte';

	let { variant, class: className = '' }: { variant: PrivacyBadgeVariant; class?: string } = $props();
	const c = $derived(getCopy(demo.language));

	const ICON = { public: Eye, 'owner-only': Unlock, encrypted: Lock, 'demo-simulation': FlaskConical, 'on-chain-evidence': Link2 };
	// Purple is reserved for interactive controls so it stays meaningful. These
	// are passive classification labels, so public/owner-only/encrypted share
	// one neutral treatment — icon and text carry the distinction.
	const CLASS: Record<PrivacyBadgeVariant, string> = {
		public: 'bg-ink-900/5 text-ink-500 border-transparent',
		'owner-only': 'bg-ink-900/5 text-ink-500 border-transparent',
		encrypted: 'bg-ink-900/5 text-ink-500 border-transparent',
		'demo-simulation': 'bg-warning-50 text-warning-600 border-transparent',
		'on-chain-evidence': 'bg-success-50 text-success-600 border-transparent'
	};
	const Icon = $derived(ICON[variant]);
	const label = $derived(
		{
			public: c.common.public,
			'owner-only': c.common.ownerOnly,
			encrypted: c.common.encryptedOnChain,
			'demo-simulation': c.common.demoSimulation,
			'on-chain-evidence': c.common.onChainEvidence
		}[variant]
	);
</script>

<span class={['inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', CLASS[variant], className]}>
	<Icon size={11} strokeWidth={2.5} />
	{label}
</span>
