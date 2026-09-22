import type { LabeledSignature } from '../tx';

export type ActivityType = 'mint' | 'deposit' | 'withdraw' | 'confidential_transfer' | 'apply_pending';

/**
 * One activity-log entry as stored. The two amount fields at the bottom are
 * the *persisted* ground truth; what a `/state` response carries is redacted
 * per request in `state.ts`:
 *  - `disclosedAmountUi` means "an auditor disclosed this" and is only sent to
 *    a caller viewing as the auditor;
 *  - `partyAmountUi` is the real amount known at execution time, never sent
 *    as-is: it populates `partyVisibleAmountUi` only for a caller viewing as
 *    one of the entry's own parties.
 */
export type ActivityRecord = {
	id: string;
	type: ActivityType;
	fromAccountId: string;
	toAccountId: string;
	status: 'confirmed' | 'failed';
	privacy: 'public' | 'confidential';
	timestamp: number;
	signature: string;
	signatures: string[];
	steps: LabeledSignature[];
	publicAmountUi: number | null;
	auditorKeyGenerationId: string | null;
	auditorCiphertextLoHex: string | null;
	auditorCiphertextHiHex: string | null;
	disclosedAmountUi: number | null;
	partyAmountUi: number | null;
};

export type DisclosureRecord = {
	id: string;
	activityId: string;
	requestedBy: string;
	reason: string;
	timestamp: number;
	keyGenerationId: string;
	decryptedAmountUi: number;
	outcome: 'success' | 'wrong_key_generation';
};

export type GenerationRecord = {
	id: string;
	generation: number;
	label: string;
	elgamalPubkey: string;
	createdAt: number;
	retiredAt: number | null;
	status: 'active' | 'retired';
};

export interface Store {
	readonly kind: 'postgres' | 'memory';
	activityAll(): Promise<ActivityRecord[]>;
	activityFind(id: string): Promise<ActivityRecord | null>;
	activityAppend(entry: ActivityRecord): Promise<void>;
	activitySetDisclosed(id: string, amountUi: number): Promise<void>;
	disclosuresAll(): Promise<DisclosureRecord[]>;
	disclosureAppend(entry: DisclosureRecord): Promise<void>;
	generationsAll(): Promise<GenerationRecord[]>;
	/** Ensure generation N has a record, marking every other one retired if N is newest. */
	generationEnsure(generation: number, elgamalPubkey: string, now: number): Promise<void>;
	generationRotate(newGeneration: number, elgamalPubkey: string, now: number): Promise<void>;
}
