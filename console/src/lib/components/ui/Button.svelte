<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
	type Size = 'sm' | 'md';

	const VARIANT_CLASSES: Record<Variant, string> = {
		primary: 'bg-brand-600 text-white hover:bg-brand-700 focus-visible:outline-brand-600 disabled:bg-ink-400',
		secondary:
			'bg-white text-ink-700 border border-border-strong hover:bg-canvas focus-visible:outline-brand-600 disabled:text-ink-400',
		ghost: 'bg-transparent text-ink-700 hover:bg-ink-900/5 focus-visible:outline-brand-600 disabled:text-ink-400',
		danger: 'bg-danger-500 text-white hover:bg-danger-600 focus-visible:outline-danger-500 disabled:bg-ink-400'
	};
	const SIZE_CLASSES: Record<Size, string> = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2.5 text-sm' };

	let {
		variant = 'primary',
		size = 'md',
		class: className = '',
		type = 'button',
		children,
		...rest
	}: HTMLButtonAttributes & { variant?: Variant; size?: Size; class?: string; children: Snippet } = $props();
</script>

<button
	{type}
	class={[
		'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed',
		VARIANT_CLASSES[variant],
		SIZE_CLASSES[size],
		className
	]}
	{...rest}
>
	{@render children()}
</button>
