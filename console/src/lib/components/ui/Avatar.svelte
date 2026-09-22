<script lang="ts">
	// Each persona has a fixed colour so it reads the same everywhere: the
	// sender is yellow, the receiver blue. Purple is kept for the auditor
	// console and interactive controls, green for "confirmed" status.
	const PERSONA_COLOR: Record<string, string> = {
		sender: 'bg-warning-100 text-warning-600',
		receiver: 'bg-sky-100 text-sky-600'
	};
	const FALLBACK_COLOR = 'bg-ink-900/5 text-ink-700';

	let { initials, seed, size = 'md' }: { initials: string; seed: string; size?: 'sm' | 'md' | 'lg' } = $props();
	const sizeClass = $derived(
		size === 'sm' ? 'h-7 w-7 text-xs' : size === 'lg' ? 'h-11 w-11 text-base' : 'h-9 w-9 text-sm'
	);
</script>

<span
	class={[
		'inline-flex shrink-0 items-center justify-center rounded-full font-semibold',
		sizeClass,
		PERSONA_COLOR[seed] ?? FALLBACK_COLOR
	]}
>
	{initials}
</span>
