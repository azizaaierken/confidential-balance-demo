import type { EvidenceStep } from '$lib/types';

// The server records exactly one real signature for a V1 transfer/withdraw —
// but that one transaction still bundles several instructions (proof
// verifications + the transfer/withdraw itself), which is exactly the part
// Solscan can't label. Expand that single step into one row per instruction,
// in on-chain order, all sharing the same signature, so the breakdown stays
// visible instead of collapsing to a single opaque row. A no-op for anything
// else (older multi-transaction entries, or a single step that isn't one of
// these two labels).
export function expandEvidenceSteps(steps: EvidenceStep[], kind: 'transfer' | 'withdraw'): EvidenceStep[] {
	if (steps.length !== 1) return steps;
	const [only] = steps;
	const sig = only.signature;
	if (kind === 'transfer' && only.label === 'submit_transfer_v1') {
		return [
			{ label: 'verify_equality_proof', signature: sig },
			{ label: 'verify_validity_proof', signature: sig },
			{ label: 'verify_range_proof', signature: sig },
			{ label: 'submit_transfer_v1', signature: sig }
		];
	}
	if (kind === 'withdraw' && only.label === 'submit_withdraw_v1') {
		return [
			{ label: 'submit_withdraw_v1', signature: sig },
			{ label: 'verify_equality_proof', signature: sig },
			{ label: 'verify_range_proof', signature: sig }
		];
	}
	return steps;
}
