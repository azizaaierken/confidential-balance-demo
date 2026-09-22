/**
 * End-to-end round trip on devnet:
 *
 *   mint -> deposit -> apply-pending -> confidential transfer in ONE V1
 *   transaction (auditor ciphertext captured) -> auditor decrypt with the
 *   active generation -> decrypt with the wrong generation fails ->
 *   apply-pending (receiver) -> withdraw (V1).
 *
 * It spends devnet SOL and mutates the demo accounts, so it is a script, not
 * a test. Requires a bootstrapped console/.env.
 */
import { readAccountView } from '../src/lib/server/accounts';
import { MINT_DECIMALS } from '../src/lib/server/config';
import { deriveAuditorGeneration, elgamalPubkeyToAddress, loadDemoSigners } from '../src/lib/server/keys';
import { applyPending } from '../src/lib/server/ops/applyPending';
import { decryptAuditorAmount, resolveActiveGeneration } from '../src/lib/server/ops/auditor';
import { deposit } from '../src/lib/server/ops/deposit';
import { mintSupply, readMintConfig } from '../src/lib/server/ops/mint';
import { simulateTransfer, transferConfidential } from '../src/lib/server/ops/transfer';
import { withdraw } from '../src/lib/server/ops/withdraw';
import { getRpc, getRpcUrl } from '../src/lib/server/rpc';
import { ensureConfidentialAccount, ensurePayerFunded } from '../src/lib/server/setup';

const MINT_AMOUNT = 20_000n; // 200.00 at 2 decimals
const TRANSFER_AMOUNT = 5_000n; // 50.00
const WITHDRAW_AMOUNT = 2_000n; // 20.00

function fail(msg: string): never {
	throw new Error(msg);
}

async function main() {
	const t0 = Date.now();
	const step = (s: string) => console.log(`\n== ${s} (+${((Date.now() - t0) / 1000).toFixed(1)}s) ==`);

	step('setting up (idempotent)');
	const env = await loadDemoSigners();
	const rpc = getRpc();
	console.log(`rpc: ${getRpcUrl()}`);
	await ensurePayerFunded(rpc, env.payer);
	for (const owner of [env.sender, env.receiver]) await ensureConfidentialAccount(rpc, env.payer, owner, env.mint);
	const mintConfig = await readMintConfig(rpc, env.mint);
	const active = await resolveActiveGeneration(env.auditorRoot, env.mint, mintConfig.auditorElgamalPubkey);
	if (!active) fail('mint auditor key is not derived from AUDITOR_ROOT_KEYPAIR');
	console.log(`mint: ${env.mint}\nsender: ${env.sender.address}\nreceiver: ${env.receiver.address}`);
	console.log(`active auditor generation: ${active.generation} (${active.pubkey})`);

	step(`1. mint ${MINT_AMOUNT} base units to sender's public balance`);
	console.log('signature:', await mintSupply(rpc, env.payer, env.mint, env.mintAuthority, env.sender.address, MINT_AMOUNT));

	step(`2. deposit ${MINT_AMOUNT} to sender's pending balance`);
	console.log('signature:', await deposit(rpc, env.payer, env.sender, env.mint, MINT_AMOUNT));

	step("3. apply sender's pending balance");
	const applied = await applyPending(rpc, env.payer, env.sender, env.mint);
	console.log(`signature: ${applied.signature} | applied ${applied.appliedAmount} | new available ${applied.newAvailable}`);

	step(`4a. simulate confidential transfer sender -> receiver, amount ${TRANSFER_AMOUNT}`);
	const sim = await simulateTransfer(rpc, env.payer, env.sender, env.mint, env.receiver.address, TRANSFER_AMOUNT);
	console.log(`simulation: success=${sim.success} units=${sim.unitsConsumed} fee=${sim.feeLamports} error=${sim.error}`);
	if (!sim.success) {
		console.log(sim.logs.join('\n'));
		fail('simulation failed');
	}

	step(`4b. confidential transfer in ONE v1 transaction`);
	const result = await transferConfidential(rpc, env.payer, env.sender, env.mint, env.receiver.address, TRANSFER_AMOUNT);
	for (const s of result.steps) console.log(`  [${s.label}] ${s.signature}`);
	if (result.steps.length !== 1) fail(`expected one transaction, got ${result.steps.length}`);
	if (!result.auditorCiphertextLoHex || !result.auditorCiphertextHiHex) fail('no auditor ciphertext captured');
	console.log('auditor ciphertext captured: lo/hi 64 bytes each');

	step(`5. auditor disclosure with the active generation ${active.generation}`);
	const disclosed = decryptAuditorAmount(result.auditorCiphertextLoHex, result.auditorCiphertextHiHex, active.elgamal);
	console.log(`disclosed amount: ${disclosed} (expected ${TRANSFER_AMOUNT}) -> ${disclosed === TRANSFER_AMOUNT ? 'MATCH' : 'MISMATCH'}`);
	if (disclosed !== TRANSFER_AMOUNT) fail('disclosure mismatch');

	step(`6. auditor disclosure with the WRONG generation ${active.generation + 1} must fail safely`);
	const wrong = await deriveAuditorGeneration(env.auditorRoot, env.mint, active.generation + 1);
	const wrongResult = decryptAuditorAmount(result.auditorCiphertextLoHex, result.auditorCiphertextHiHex, wrong);
	console.log(`generation ${active.generation + 1} (${elgamalPubkeyToAddress(wrong)}) -> ${wrongResult === null ? 'not disclosable under this generation (OK)' : `DECRYPTED ${wrongResult} (BAD)`}`);
	if (wrongResult !== null) fail('wrong generation decrypted');

	step("7. apply receiver's pending balance");
	const applied2 = await applyPending(rpc, env.payer, env.receiver, env.mint);
	console.log(`signature: ${applied2.signature} | applied ${applied2.appliedAmount} | new available ${applied2.newAvailable}`);
	if (applied2.appliedAmount < TRANSFER_AMOUNT) fail('receiver did not receive the transfer');

	step(`8. withdraw ${WITHDRAW_AMOUNT} from receiver's confidential balance (v1)`);
	const w = await withdraw(rpc, env.payer, env.receiver, env.mint, WITHDRAW_AMOUNT);
	for (const s of w.steps) console.log(`  [${s.label}] ${s.signature}`);

	step('final balances');
	const sv = await readAccountView(rpc, env.mint, env.sender);
	const rv = await readAccountView(rpc, env.mint, env.receiver);
	const fmt = (v: typeof sv) => `public=${v.public} pending=${v.pending} available=${v.available}`;
	console.log(`sender:   ${fmt(sv)}`);
	console.log(`receiver: ${fmt(rv)}`);
	console.log(`mint total supply: ${(await readMintConfig(rpc, env.mint)).supply} (decimals ${MINT_DECIMALS})`);
	console.log(`\nSPIKE PASSED in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
	console.error(`SPIKE FAILED: ${e instanceof Error ? (e.stack ?? e.message) : e}`);
	process.exit(1);
});
