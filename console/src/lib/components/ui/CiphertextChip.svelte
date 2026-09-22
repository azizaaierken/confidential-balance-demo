<script lang="ts">
	import { Lock } from '@lucide/svelte';
	let { ciphertext }: { ciphertext: string } = $props();
</script>

<span
	class="inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-ink-900/5 px-2 py-1 font-mono text-xs text-ink-500"
	title={ciphertext}
>
	<Lock size={11} strokeWidth={2.5} />
	{ciphertext.slice(0, 10)}…
</span>
