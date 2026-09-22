<script lang="ts">
	import { ShieldAlert } from '@lucide/svelte';
	import Drawer from '$lib/components/ui/Drawer.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import ProgressTracker, { type TrackerStep } from '$lib/components/ui/ProgressTracker.svelte';
	import WarningNote from '$lib/components/ui/WarningNote.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import EvidenceDisclosure from '$lib/components/ui/EvidenceDisclosure.svelte';
	import EvidenceRow from '$lib/components/ui/EvidenceRow.svelte';
	import EvidenceSteps from '$lib/components/ui/EvidenceSteps.svelte';
	import { expandEvidenceSteps } from '$lib/components/ui/evidence-steps';
	import SolscanLink from '$lib/components/ui/SolscanLink.svelte';
	import * as backend from '$lib/backend/client';
	import { demo } from '$lib/store/demo-store.svelte';
	import { MINT, PERSONAS } from '$lib/entities.svelte';
	import type { ActivityEntry, FailureStage } from '$lib/types';
	import { formatAmount, shortenAddress } from '$lib/format';
	import { getCopy } from '$lib/i18n';
	import { stageLabel } from '$lib/i18n/helpers';
	import { classifyFailure } from '$lib/failure';

	type FlowStep = 'review' | 'signing' | 'progress' | 'result';
	type SimulationState =
		| { status: 'idle' }
		| { status: 'running' }
		| { status: 'done'; result: backend.TransferSimulation }
		| { status: 'unavailable'; reason: string };

	const LAMPORTS_PER_SOL = 1_000_000_000;

	// A confidential transfer is one V1 transaction: the server generates the
	// three proofs, builds the transaction, then submits and waits for
	// confirmation in a single call. The tracker shows exactly those two phases
	// and nothing the UI can't actually observe.
	const STAGE_TO_STEP_INDEX: Record<FailureStage, number> = { proof_generation: 0, submission: 1, confirmation: 1 };

	let { open, onClose, fromAccountId }: { open: boolean; onClose: () => void; fromAccountId: string } = $props();
	const c = $derived(getCopy(demo.language));

	const STEPS: TrackerStep[] = $derived([
		{ key: 'build', label: c.sendTransfer.stepProof },
		{ key: 'confirm', label: c.sendTransfer.stepSubmitted }
	]);

	const recipients = $derived(PERSONAS.filter((p) => p.id !== fromAccountId));
	let toId = $state('');
	$effect(() => {
		if (!toId && recipients[0]) toId = recipients[0].id;
	});
	let amount = $state('');
	let step = $state<FlowStep>('review');
	let result = $state<ActivityEntry | null>(null);
	let error = $state<string | null>(null);
	let failureStage = $state<FailureStage | null>(null);

	const fromPersona = $derived(PERSONAS.find((p) => p.id === fromAccountId));
	const available = $derived(demo.balances[fromAccountId]?.confidentialAvailable.decrypted ?? 0);
	const numericAmount = $derived(parseFloat(amount) || 0);
	const preflightInsufficient = $derived(numericAmount > available);

	// Building the transaction means generating all three ZK proofs, so this is
	// a real ~2-3s round trip, not something to fire on every keystroke — hence
	// the debounce. The over-balance case is settled locally first and never
	// reaches the node. Only the *outcome* of a simulation lives in state,
	// tagged with the inputs it was run for; "idle" and "running" are derived,
	// so a stale outcome can never be shown against fresh inputs.
	const shouldSimulate = $derived(open && step === 'review' && numericAmount > 0 && !preflightInsufficient && Boolean(toId));
	const simulationKey = $derived(`${fromAccountId}|${toId}|${numericAmount}`);
	let simulationOutcome = $state<{ key: string; state: Extract<SimulationState, { status: 'done' | 'unavailable' }> } | null>(null);
	const simulation: SimulationState = $derived(
		!shouldSimulate
			? { status: 'idle' }
			: simulationOutcome?.key === simulationKey
				? simulationOutcome.state
				: { status: 'running' }
	);

	$effect(() => {
		if (!shouldSimulate) return;
		const key = simulationKey;
		const [from, to, amt] = [fromAccountId, toId, numericAmount];
		let cancelled = false;
		const timer = setTimeout(async () => {
			try {
				const result = await backend.simulateTransfer(from, to, amt, demo.viewRoles);
				if (!cancelled) simulationOutcome = { key, state: { status: 'done', result } };
			} catch (e) {
				// Couldn't build or couldn't reach the cluster — report it as such
				// rather than as a verdict on the transfer itself.
				if (!cancelled) simulationOutcome = { key, state: { status: 'unavailable', reason: e instanceof Error ? e.message : String(e) } };
			}
		}, 700);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	});

	function handleClose() {
		step = 'review';
		amount = '';
		result = null;
		error = null;
		failureStage = null;
		toId = recipients[0]?.id ?? '';
		onClose();
	}

	async function submitTransfer() {
		step = 'progress';
		try {
			result = await demo.confidentialTransfer(fromAccountId, toId, numericAmount);
			step = 'result';
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			failureStage = classifyFailure(message);
			error = message;
			step = 'result';
		}
	}

	// While the request is in flight the UI cannot tell which phase the server
	// is in, so the first step stays active until the whole call returns. On
	// success both steps are done; on failure the classified stage decides
	// which one is marked failed.
	const trackerIndex = $derived(
		step === 'progress' ? 0 : result ? STEPS.length : failureStage ? STAGE_TO_STEP_INDEX[failureStage] : 0
	);
</script>

<Drawer {open} onClose={handleClose} title={c.sendTransfer.title} subtitle={`${MINT.symbol} · ${MINT.cluster}`}>
	{#snippet footer()}
		{#if step === 'review'}
			<div class="flex justify-end gap-3">
				<Button variant="secondary" onclick={handleClose}>{c.common.cancel}</Button>
				<Button disabled={numericAmount <= 0 || preflightInsufficient || !toId} onclick={() => (step = 'signing')}>
					{c.sendTransfer.reviewAndSign}
				</Button>
			</div>
		{:else if step === 'signing'}
			<div class="flex justify-end gap-3">
				<Button variant="secondary" onclick={() => (step = 'review')}>{c.common.back}</Button>
				<Button onclick={submitTransfer}>{c.sendTransfer.approveInWallet}</Button>
			</div>
		{:else if step === 'result'}
			<div class="flex justify-end"><Button onclick={handleClose}>{c.common.done}</Button></div>
		{/if}
	{/snippet}

	{#if step === 'review'}
		<div class="flex flex-col gap-5">
			<div class="grid grid-cols-2 gap-3 rounded-xl border border-border-subtle p-4 text-sm">
				<div>
					<p class="text-ink-500">{c.sendTransfer.network}</p>
					<p class="font-medium text-ink-900">{MINT.cluster}</p>
				</div>
				<div>
					<p class="text-ink-500">{c.sendTransfer.assetMint}</p>
					<p class="font-medium text-ink-900">{MINT.symbol} · {shortenAddress(MINT.address)}</p>
				</div>
				<div>
					<p class="text-ink-500">{c.sendTransfer.sender}</p>
					<p class="font-medium text-ink-900">{fromPersona?.name}</p>
				</div>
				<div>
					<p class="text-ink-500">{c.sendTransfer.feePayer}</p>
					<p class="font-mono text-ink-900">{shortenAddress(MINT.feePayer)}</p>
					<p class="text-xs text-ink-500">{c.sendTransfer.feePayerNote}</p>
				</div>
			</div>

			<label class="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
				{c.sendTransfer.receiver}
				<select
					bind:value={toId}
					class="rounded-lg border border-border-strong px-3 py-2.5 text-sm text-ink-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
				>
					{#each recipients as p (p.id)}
						<option value={p.id}>{p.name} · {shortenAddress(p.address)}</option>
					{/each}
				</select>
			</label>

			<label class="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
				{MINT.symbol} {c.sendTransfer.amountLabel}
				<input
					bind:value={amount}
					inputmode="decimal"
					placeholder="0.00"
					class="rounded-lg border border-border-strong px-3 py-2.5 text-sm text-ink-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
				/>
				<span class="text-xs font-normal text-ink-500">{c.sendTransfer.availableBalance(formatAmount(available), MINT.symbol)}</span>
			</label>

			<div class="rounded-xl border border-border-subtle bg-canvas/60 p-4 text-sm">
				<p class="mb-1 font-medium text-ink-700">{c.sendTransfer.simulationTitle}</p>
				{#if numericAmount <= 0}
					<p class="text-ink-500">{c.sendTransfer.simulationEmpty}</p>
				{:else if preflightInsufficient}
					<p class="text-danger-600">{c.sendTransfer.simulationInsufficient}</p>
				{:else if simulation.status === 'running' || simulation.status === 'idle'}
					<p class="text-ink-500">{c.sendTransfer.simulationRunning}</p>
				{:else if simulation.status === 'unavailable'}
					<p class="text-warning-600">{c.sendTransfer.simulationUnavailable(simulation.reason)}</p>
				{:else if simulation.result.success}
					<p class="text-success-600">
						{c.sendTransfer.simulationSuccess(
							simulation.result.feeLamports != null ? (simulation.result.feeLamports / LAMPORTS_PER_SOL).toFixed(6) : '—',
							simulation.result.unitsConsumed?.toLocaleString() ?? '—'
						)}
					</p>
				{:else}
					<p class="text-danger-600">{c.sendTransfer.simulationFailed(simulation.result.error ?? 'unknown error')}</p>
				{/if}
			</div>

			<WarningNote>{c.sendTransfer.addressWarning}</WarningNote>
		</div>
	{:else if step === 'signing'}
		<div class="flex flex-col items-center gap-4 py-10 text-center">
			<div class="rounded-full bg-ink-900/5 p-4"><ShieldAlert size={28} class="text-ink-500" /></div>
			<div>
				<p class="text-base font-semibold text-ink-900">{c.sendTransfer.waitingWalletTitle}</p>
				<p class="mt-1 text-sm text-ink-500">{c.sendTransfer.waitingWalletBody}</p>
			</div>
			<p class="font-mono text-xs text-ink-400">{shortenAddress(demo.connectedWalletAddress)}</p>
		</div>
	{:else if step === 'progress'}
		<div class="py-4"><ProgressTracker steps={STEPS} currentIndex={trackerIndex} failedAtIndex={null} /></div>
	{:else if error}
		<div class="flex flex-col gap-5">
			<ProgressTracker steps={STEPS} currentIndex={trackerIndex} failedAtIndex={trackerIndex} />
			<div class="rounded-xl border border-danger-100 bg-danger-50 p-4 text-sm text-danger-600">
				<p class="font-medium">{c.sendTransfer.resultFailedAt(failureStage ? stageLabel(c, failureStage) : '')}</p>
				<p class="mt-1">{error}</p>
			</div>
		</div>
	{:else if result}
		<div class="flex flex-col gap-5">
			<StatusBadge status={result.status} />
			<div class="rounded-xl border border-success-100 bg-success-50 p-4 text-sm text-success-600">{c.sendTransfer.resultConfirmed}</div>
			<EvidenceDisclosure label={c.sendTransfer.evidenceTitle} defaultOpen>
				<EvidenceRow label={c.evidence.signatureLabel} value={result.signature} />
				<EvidenceRow label={c.evidence.programActivityLabel} value={result.programActivity.join(', ')} />
				{#if result.confidential}
					<EvidenceRow label={c.evidence.ciphertextLabel} value={result.confidential.ciphertext} />
				{/if}
			</EvidenceDisclosure>
			<EvidenceSteps steps={expandEvidenceSteps(result.steps, 'transfer')} />
			<SolscanLink signature={result.signature} />
		</div>
	{/if}
</Drawer>
