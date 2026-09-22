/**
 * Transaction-message assembly shared by every operation.
 *
 * Two shapes are used: plain legacy messages for the instructions that need
 * no ZK proof (deposit, apply, mint, configure), and version-1 (SIMD-0385)
 * messages for the ones that carry proofs inline. V1 raises the size limit
 * from 1,232 to 4,096 bytes — the combined equality + validity + range verify
 * instructions plus the transfer come to ~2.4KB — but its resource budgets
 * default to zero rather than the network default, so both are set here
 * explicitly on every V1 message.
 */
import {
	appendTransactionMessageInstructions,
	createTransactionMessage,
	pipe,
	setTransactionMessageConfig,
	setTransactionMessageFeePayerSigner,
	setTransactionMessageLifetimeUsingBlockhash,
	type Instruction,
	type KeyPairSigner
} from '@solana/kit';
import { latestBlockhash, type SolanaRpc } from './rpc';

/**
 * The max the network allows a single transaction to request. Verifying
 * three ZK proofs (the range proof especially) in one transaction is far past
 * the 200,000 CU a legacy transaction gets without asking, so ask for the
 * ceiling outright rather than tune a number against a cost that depends on
 * proof sizes.
 */
export const COMPUTE_UNIT_LIMIT = 1_400_000;

/**
 * V1 requires an explicit ask for both budgets — an unset
 * `loadedAccountsDataSizeLimit` means 0 bytes, not "use the network
 * default", and a transaction touching the token accounts, mint and ZK proof
 * program fails simulation outright without it. 64MB matches the effective
 * legacy default (`MAX_LOADED_ACCOUNTS_DATA_SIZE_BYTES`).
 */
export const LOADED_ACCOUNTS_DATA_SIZE_LIMIT = 64 * 1024 * 1024;

export async function buildLegacyMessage(
	rpc: SolanaRpc,
	payer: KeyPairSigner,
	instructions: readonly Instruction[]
) {
	const blockhash = await latestBlockhash(rpc);
	return pipe(
		createTransactionMessage({ version: 'legacy' }),
		(m) => setTransactionMessageFeePayerSigner(payer, m),
		(m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
		(m) => appendTransactionMessageInstructions(instructions, m)
	);
}

export async function buildV1Message(
	rpc: SolanaRpc,
	payer: KeyPairSigner,
	instructions: readonly Instruction[]
) {
	const blockhash = await latestBlockhash(rpc);
	return pipe(
		createTransactionMessage({ version: 1 }),
		(m) => setTransactionMessageFeePayerSigner(payer, m),
		(m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
		(m) => appendTransactionMessageInstructions(instructions, m),
		(m) =>
			setTransactionMessageConfig(
				{
					computeUnitLimit: COMPUTE_UNIT_LIMIT,
					loadedAccountsDataSizeLimit: LOADED_ACCOUNTS_DATA_SIZE_LIMIT
				},
				m
			)
	);
}

/** Flatten an `InstructionPlan` from the token-2022 helpers into its instructions. */
export function flattenPlan(plan: unknown): Instruction[] {
	const out: Instruction[] = [];
	const walk = (p: unknown) => {
		if (!p || typeof p !== 'object') return;
		const node = p as { kind?: string; instruction?: Instruction; plans?: unknown[] };
		if (node.kind === 'single' && node.instruction) out.push(node.instruction);
		else if (Array.isArray(node.plans)) node.plans.forEach(walk);
		else throw new Error(`cannot flatten instruction plan node of kind ${node.kind}`);
	};
	walk(plan);
	return out;
}

/** Stable key for what one real transaction did; the frontend translates it. */
export type LabeledSignature = { label: string; signature: string; part?: number };
