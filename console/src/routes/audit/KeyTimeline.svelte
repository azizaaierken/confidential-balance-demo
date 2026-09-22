<script lang="ts">
	import { KeyRound } from '@lucide/svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import CardHeader from '$lib/components/ui/CardHeader.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import type { AuditorKeyGeneration } from '$lib/types';
	import { formatTimestamp } from '$lib/format';
	import { getCopy } from '$lib/i18n';
	import { demo } from '$lib/store/demo-store.svelte';

	let {
		generations,
		unlocked,
		onRotate
	}: { generations: AuditorKeyGeneration[]; unlocked: boolean; onRotate: () => Promise<unknown> } = $props();
	const c = $derived(getCopy(demo.language));

	let showConfirm = $state(false);
	let phrase = $state('');
	let rotating = $state(false);
	let error = $state(false);

	const requiredPhrase = $derived(c.audit.rotateConfirmPhrasePlaceholder);
	const phraseMatches = $derived(phrase.trim() === requiredPhrase);

	async function handleRotate() {
		rotating = true;
		error = false;
		try {
			await onRotate();
			showConfirm = false;
			phrase = '';
		} catch {
			error = true;
		} finally {
			rotating = false;
		}
	}
</script>

<Card>
	<CardHeader title={c.audit.keyTimelineTitle} subtitle={c.audit.keyTimelineSubtitle}>
		{#snippet action()}
			<Button size="sm" variant="secondary" disabled={!unlocked} onclick={() => (showConfirm = !showConfirm)}>
				<KeyRound size={14} /> {c.audit.rotateButton}
			</Button>
		{/snippet}
	</CardHeader>
	{#if showConfirm}
		<div class="flex flex-col gap-3 border-b border-border-subtle bg-canvas/60 px-5 py-4">
			<p class="text-sm font-medium text-ink-900">{c.audit.rotateConfirmTitle}</p>
			<p class="text-xs text-ink-500">{c.audit.rotateConfirmBody}</p>
			<label class="flex flex-col gap-1 text-xs font-medium text-ink-700">
				{c.audit.rotateConfirmPhraseLabel(requiredPhrase)}
				<input bind:value={phrase} placeholder={requiredPhrase} class="rounded-lg border border-border-strong px-3 py-2 text-sm" />
			</label>
			{#if phrase.length > 0 && !phraseMatches}
				<p class="text-xs text-danger-600">{c.audit.rotateConfirmPhraseMismatch}</p>
			{/if}
			{#if error}<p class="text-xs text-danger-600">{c.common.actionFailed}</p>{/if}
			<div class="flex justify-end gap-2">
				<Button size="sm" variant="secondary" onclick={() => (showConfirm = false)}>{c.common.cancel}</Button>
				<Button size="sm" disabled={!phraseMatches || rotating} onclick={handleRotate}>
					{rotating ? c.common.processing : c.audit.rotateConfirmButton}
				</Button>
			</div>
		</div>
	{/if}
	<div class="flex flex-col gap-3 px-5 py-4">
		{#each generations as g (g.id)}
			<div
				class={[
					'flex items-center justify-between gap-4 rounded-xl border px-4 py-3 text-sm',
					g.status === 'active' ? 'border-brand-100 bg-brand-50' : 'border-border-subtle bg-canvas/60'
				]}
			>
				<div>
					<p class="font-medium text-ink-900">{c.audit.keyGenLabel(g.generation)}</p>
					<p class="text-xs text-ink-500">
						{c.audit.createdLabel(formatTimestamp(g.createdAt))}{g.retiredAt ? ` · ${c.audit.retiredLabel(formatTimestamp(g.retiredAt))}` : ''}
					</p>
				</div>
				<!-- Both are real on-chain key registrations; only one is current. -->
				<span
					class={[
						'rounded-full px-2 py-0.5 text-[11px] font-medium',
						g.status === 'active' ? 'bg-brand-100 text-brand-700' : 'bg-ink-900/5 text-ink-500'
					]}
				>
					{g.status === 'active' ? c.audit.statusActive : c.audit.statusRetired}
				</span>
			</div>
		{/each}
		<p class="text-xs text-ink-400">{c.audit.rotationNote}</p>
	</div>
</Card>
