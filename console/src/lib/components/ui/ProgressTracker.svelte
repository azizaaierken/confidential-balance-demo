<script lang="ts" module>
	export interface TrackerStep {
		key: string;
		label: string;
	}
</script>

<script lang="ts">
	import { Check, X, Loader2 } from '@lucide/svelte';

	let {
		steps,
		currentIndex,
		failedAtIndex = null
	}: { steps: TrackerStep[]; currentIndex: number; failedAtIndex?: number | null } = $props();
</script>

<ol class="flex flex-col gap-0">
	{#each steps as step, i (step.key)}
		{@const isFailed = failedAtIndex === i}
		{@const isDone = !isFailed && i < currentIndex}
		{@const isActive = !isFailed && i === currentIndex && failedAtIndex == null}
		{@const isLast = i === steps.length - 1}
		<li class="flex gap-3">
			<div class="flex flex-col items-center">
				<span
					class={[
						'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold',
						isFailed && 'border-danger-500 bg-danger-50 text-danger-600',
						isDone && 'border-success-500 bg-success-500 text-white',
						isActive && 'border-brand-600 bg-brand-50 text-brand-700',
						!isDone && !isActive && !isFailed && 'border-border-strong bg-white text-ink-400'
					]}
				>
					{#if isFailed}
						<X size={14} strokeWidth={3} />
					{:else if isDone}
						<Check size={14} strokeWidth={3} />
					{:else if isActive}
						<Loader2 size={14} class="animate-spin motion-reduce:animate-none" />
					{:else}
						{i + 1}
					{/if}
				</span>
				{#if !isLast}
					<span class={['w-0.5 min-h-6 flex-1', isDone ? 'bg-success-500' : 'bg-border-strong']}></span>
				{/if}
			</div>
			<div class="pb-6 pt-0.5">
				<p
					class={[
						'text-sm font-medium',
						isFailed ? 'text-danger-600' : isActive ? 'text-brand-700' : isDone ? 'text-ink-900' : 'text-ink-400'
					]}
				>
					{step.label}
				</p>
			</div>
		</li>
	{/each}
</ol>
