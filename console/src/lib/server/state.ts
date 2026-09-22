/**
 * The full console state, built internally with every key (the server can
 * always decrypt both balances) and then redacted to what the caller's roles
 * are entitled to see. A caller with no roles gets mint config, public
 * balances and activity metadata only: no decrypted confidential amounts, no
 * disclosed amounts, no disclosure records.
 */
import { TOKEN_2022_PROGRAM_ADDRESS, decodeMint, decodeToken } from '@solana-program/token-2022';
import type { Address } from '@solana/kit';
import { EMPTY_VIEW, ZK_PROOF_PROGRAM_ID, ataFor, decodeAccountView, fetchAccounts, type AccountView } from './accounts';
import { baseToUi } from './amounts';
import { MINT_DECIMALS, clusterLabel } from './config';
import type { AppContext } from './context';
import { decodeMintConfig } from './ops/mint';
import type { Role } from './roles';
import type { DisclosureRecord, GenerationRecord } from './store';

export type ConfidentialAmountView = { ciphertext: string; decrypted: number | null };

export type BalanceView = {
	accountId: string;
	address: string;
	tokenAccount: string;
	publicBalance: number;
	confidentialAvailable: ConfidentialAmountView;
	confidentialPending: ConfidentialAmountView;
};

export type ActivityView = {
	id: string;
	type: string;
	fromAccountId: string;
	toAccountId: string;
	status: string;
	privacy: string;
	timestamp: number;
	signature: string;
	signatures: string[];
	steps: { label: string; signature: string; part?: number }[];
	publicAmountUi?: number;
	auditorKeyGenerationId?: string;
	auditorCiphertextLoHex?: string;
	auditorCiphertextHiHex?: string;
	disclosedAmountUi?: number;
	partyVisibleAmountUi?: number;
};

export type StateResponse = {
	ok: true;
	mint: {
		address: string;
		name: string;
		symbol: string;
		decimals: number;
		programId: string;
		zkProofProgramId: string;
		confidentialTransferAuthority: string;
		feePayer: string;
		extensions: string[];
		autoApproveNewAccounts: boolean;
		cluster: string;
		auditorElgamalPubkey: string | null;
		activeAuditorGeneration: number | null;
	};
	totalSupply: number;
	balances: Record<string, BalanceView>;
	auditorKeyGenerations: GenerationRecord[];
	activity: ActivityView[];
	auditDisclosures: DisclosureRecord[];
	storage: 'postgres' | 'memory';
};

export async function readState(ctx: AppContext, roles: readonly Role[]): Promise<StateResponse> {
	const [senderAta, receiverAta] = await Promise.all([
		ataFor(ctx.sender.address, ctx.mint),
		ataFor(ctx.receiver.address, ctx.mint)
	]);

	// Everything the state needs from the chain is three accounts: one round trip.
	const [senderAcc, receiverAcc, mintAcc] = await fetchAccounts(ctx.rpc, [senderAta, receiverAta, ctx.mint]);
	if (!mintAcc.exists) throw new Error(`mint ${ctx.mint} not found on chain`);
	const mint = decodeMint(mintAcc).data;
	const mintConfig = decodeMintConfig(mint);
	// Make sure the generation the mint currently points at is in the
	// timeline, so generation 1 shows up before any rotation has happened.
	await ctx.activeGeneration(mintConfig.auditorElgamalPubkey);

	const view = async (acc: typeof senderAcc, owner: typeof ctx.sender, ata: Address): Promise<AccountView> =>
		acc.exists ? decodeAccountView(decodeToken(acc).data, owner, ata) : EMPTY_VIEW;
	const [senderView, receiverView] = await Promise.all([
		view(senderAcc, ctx.sender, senderAta),
		view(receiverAcc, ctx.receiver, receiverAta)
	]);

	const showSender = roles.includes('sender');
	const showReceiver = roles.includes('receiver');
	const showAuditor = roles.includes('auditor');

	// Two independent visibility channels on two separate wire fields:
	// `disclosedAmountUi` means "an auditor disclosed this" and reflects only
	// showAuditor; `partyVisibleAmountUi` means "you're one of this entry's own
	// parties" and reflects only isParty. Merging them regressed the Audit
	// Console once: a party's own transfer looked auditor-disclosed to them.
	const activity: ActivityView[] = (await ctx.store.activityAll()).map((e) => {
		const isParty =
			(showSender && (e.fromAccountId === 'sender' || e.toAccountId === 'sender')) ||
			(showReceiver && (e.fromAccountId === 'receiver' || e.toAccountId === 'receiver'));
		const out: ActivityView = {
			id: e.id,
			type: e.type,
			fromAccountId: e.fromAccountId,
			toAccountId: e.toAccountId,
			status: e.status,
			privacy: e.privacy,
			timestamp: e.timestamp,
			signature: e.signature,
			signatures: e.signatures,
			steps: e.steps
		};
		if (e.publicAmountUi !== null) out.publicAmountUi = e.publicAmountUi;
		if (e.auditorKeyGenerationId !== null) out.auditorKeyGenerationId = e.auditorKeyGenerationId;
		if (e.auditorCiphertextLoHex !== null) out.auditorCiphertextLoHex = e.auditorCiphertextLoHex;
		if (e.auditorCiphertextHiHex !== null) out.auditorCiphertextHiHex = e.auditorCiphertextHiHex;
		if (showAuditor && e.disclosedAmountUi !== null) out.disclosedAmountUi = e.disclosedAmountUi;
		if (isParty && e.partyAmountUi !== null) out.partyVisibleAmountUi = e.partyAmountUi;
		return out;
	});

	const generations = await ctx.store.generationsAll();
	const active = generations.find((g) => g.status === 'active');

	return {
		ok: true,
		mint: {
			address: ctx.mint,
			name: 'Token-X',
			symbol: 'TOKEN-X',
			decimals: MINT_DECIMALS,
			programId: TOKEN_2022_PROGRAM_ADDRESS,
			zkProofProgramId: ZK_PROOF_PROGRAM_ID,
			confidentialTransferAuthority: mintConfig.authority ?? '',
			feePayer: ctx.payer.address,
			extensions: ['ConfidentialTransferMint'],
			autoApproveNewAccounts: mintConfig.autoApproveNewAccounts,
			cluster: clusterLabel(ctx.rpcUrl),
			auditorElgamalPubkey: mintConfig.auditorElgamalPubkey,
			activeAuditorGeneration: active?.generation ?? null
		},
		totalSupply: baseToUi(mintConfig.supply),
		balances: {
			sender: toBalanceView('sender', ctx.sender.address, senderAta, senderView, showSender),
			receiver: toBalanceView('receiver', ctx.receiver.address, receiverAta, receiverView, showReceiver)
		},
		auditorKeyGenerations: generations,
		activity,
		auditDisclosures: showAuditor ? await ctx.store.disclosuresAll() : [],
		storage: ctx.store.kind
	};
}

function toBalanceView(accountId: string, address: string, tokenAccount: string, v: AccountView, reveal: boolean): BalanceView {
	return {
		accountId,
		address,
		tokenAccount,
		publicBalance: baseToUi(v.public),
		confidentialAvailable: { ciphertext: v.availableCiphertextFingerprint, decrypted: reveal ? baseToUi(v.available) : null },
		confidentialPending: { ciphertext: v.pendingCiphertextFingerprint, decrypted: reveal ? baseToUi(v.pending) : null }
	};
}
