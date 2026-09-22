//! Confidential transfer between accounts (bypass mode).
//!
//! Generates the three transfer proofs (equality, ciphertext-validity,
//! range) and submits them alongside the transfer instruction in a single
//! V1 (SIMD-0385) transaction, via `ProofLocation::InstructionOffset` — the
//! proof-verify instructions ride in the same transaction as the transfer
//! itself, checked through instruction introspection, so no separate
//! context-state accounts are created or closed at all.
//!
//! This only fits because V1 transactions raise the legacy 1,232-byte limit
//! to 4,096 bytes: measured directly against this proof set, the combined
//! equality + validity + range verify instructions plus the transfer
//! instruction come to ~2.4KB — too big for a legacy transaction (which is
//! why earlier versions of this file staged the range proof through a
//! separate spl-record account across 5 transactions), comfortably under
//! the V1 ceiling.
//!
//! Adapted from solana-foundation/Confidential-Balances-Sample, extended to
//! capture the auditor's ElGamal ciphertext of the transferred amount: that
//! ciphertext exists only in this transaction's instruction data — Token-2022
//! does not persist it in any account after confirmation — so a caller that
//! wants per-transfer auditor disclosure later must capture it here, now.
//!
//! `simulate_transfer` runs the identical build path and asks the cluster to
//! simulate the resulting transaction instead of sending it.

use crate::ata::get_associated_token_address_with_program_id;
use crate::keys;
use crate::types::*;
use base64::prelude::{Engine as _, BASE64_STANDARD};
use solana_client::{
    rpc_client::RpcClient, rpc_request::RpcRequest, rpc_response::Response as RpcResponse,
};
use solana_message::{v1, VersionedMessage};
use solana_sdk::{
    pubkey::Pubkey,
    signature::{Keypair, Signature, Signer},
};
use solana_transaction::versioned::VersionedTransaction;
use solana_zk_elgamal_proof_interface::instruction::ProofInstruction;
use solana_zk_sdk::encryption::{
    auth_encryption::AeCiphertext,
    elgamal::{ElGamalCiphertext, ElGamalPubkey},
};
use solana_zk_sdk_pod::encryption::{auth_encryption::PodAeCiphertext, elgamal::PodElGamalPubkey};
use spl_token_2022::extension::{
    confidential_transfer::{
        instruction::inner_transfer, ConfidentialTransferAccount, ConfidentialTransferMint,
    },
    BaseStateWithExtensions, StateWithExtensions,
};
use spl_token_confidential_transfer_proof_extraction::instruction::ProofLocation;
use spl_token_confidential_transfer_proof_generation::transfer::transfer_split_proof_data;

/// The max the network allows a single transaction to request. Verifying
/// three ZK proofs (the range proof especially) in one transaction is far
/// past the default 200,000 CU a transaction gets without asking, so this
/// asks for the ceiling outright rather than tuning a tighter number against
/// a cost that depends on proof sizes.
const COMPUTE_UNIT_LIMIT: u32 = 1_400_000;

/// V1's `TransactionConfig` requires an explicit ask for both budgets — unlike
/// the legacy `ComputeBudgetProgram` path, an unset
/// `loaded_accounts_data_size_limit` means 0 bytes, not "use the network
/// default," and a transaction touching the token accounts, mint, and ZK
/// proof program fails simulation outright without this. 64MB matches the
/// effective legacy default (`MAX_LOADED_ACCOUNTS_DATA_SIZE_BYTES`).
const LOADED_ACCOUNTS_DATA_SIZE_LIMIT: u32 = 64 * 1024 * 1024;

/// The signed transaction plus the auditor ciphertext captured while building
/// it. Split out from submission so a simulation can run against the exact
/// transaction that would be sent — same proofs, same instructions, same
/// budgets — rather than an approximation of it.
struct BuiltTransfer {
    tx: VersionedTransaction,
    auditor_ciphertext_lo_hex: Option<String>,
    auditor_ciphertext_hi_hex: Option<String>,
}

fn build_transfer(
    client: &RpcClient,
    payer: &dyn Signer,
    sender: &Keypair,
    mint: &Pubkey,
    recipient: &Pubkey,
    amount: u64,
) -> CtResult<BuiltTransfer> {
    let sender_token_account =
        get_associated_token_address_with_program_id(&sender.pubkey(), mint, &spl_token_2022::id());
    let recipient_token_account =
        get_associated_token_address_with_program_id(recipient, mint, &spl_token_2022::id());

    let recipient_acc_data = client.get_account(&recipient_token_account)?;
    let recipient_acc =
        StateWithExtensions::<spl_token_2022::state::Account>::unpack(&recipient_acc_data.data)?;
    let recipient_ext = recipient_acc.get_extension::<ConfidentialTransferAccount>()?;
    let recipient_elgamal_pubkey: ElGamalPubkey = recipient_ext
        .elgamal_pubkey
        .try_into()
        .map_err(|e| format!("recipient ElGamal pubkey: {e:?}"))?;

    let mint_acc_data = client.get_account(mint)?;
    let mint_acc = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&mint_acc_data.data)?;
    let mint_ext = mint_acc.get_extension::<ConfidentialTransferMint>()?;
    let auditor_elgamal_pubkey: Option<ElGamalPubkey> = mint_ext
        .auditor_elgamal_pubkey
        .get()
        .map(|pod: PodElGamalPubkey| -> CtResult<ElGamalPubkey> {
            pod.try_into()
                .map_err(|e| format!("auditor ElGamal pubkey: {e:?}").into())
        })
        .transpose()?;

    let (sender_elgamal, sender_aes) = keys::derive_account_keys(sender, &sender_token_account)?;

    let sender_acc_data = client.get_account(&sender_token_account)?;
    let sender_acc =
        StateWithExtensions::<spl_token_2022::state::Account>::unpack(&sender_acc_data.data)?;
    let sender_ext = sender_acc.get_extension::<ConfidentialTransferAccount>()?;

    let current_available: ElGamalCiphertext = sender_ext
        .available_balance
        .try_into()
        .map_err(|e| format!("sender available balance: {e:?}"))?;
    let current_decryptable: AeCiphertext = sender_ext
        .decryptable_available_balance
        .try_into()
        .map_err(|e| format!("sender decryptable balance: {e:?}"))?;

    let proof_data = transfer_split_proof_data(
        &current_available,
        &current_decryptable,
        amount,
        &sender_elgamal,
        &sender_aes,
        &recipient_elgamal_pubkey,
        auditor_elgamal_pubkey.as_ref(),
    )
    .map_err(|e| format!("transfer_split_proof_data: {e}"))?;

    // Capture the auditor ciphertext now, before it's only reachable by
    // re-fetching this (soon to be built) transaction's instruction data.
    let (auditor_ciphertext_lo_hex, auditor_ciphertext_hi_hex) = if auditor_elgamal_pubkey.is_some()
    {
        (
            Some(hex::encode(bytemuck::bytes_of(
                &proof_data
                    .ciphertext_validity_proof_data_with_ciphertext
                    .ciphertext_lo,
            ))),
            Some(hex::encode(bytemuck::bytes_of(
                &proof_data
                    .ciphertext_validity_proof_data_with_ciphertext
                    .ciphertext_hi,
            ))),
        )
    } else {
        (None, None)
    };

    let current_avail_plaintext = current_decryptable
        .decrypt(&sender_aes)
        .ok_or("decrypt current available")?;
    let new_avail_plaintext = current_avail_plaintext
        .checked_sub(amount)
        .ok_or("insufficient available balance")?;
    let new_decryptable: PodAeCiphertext = sender_aes.encrypt(new_avail_plaintext).into();

    // Instructions are laid out [equality, validity, range, transfer] so the
    // transfer instruction's `InstructionOffset`s can point backward at each
    // proof by a fixed, negative index — no context-state account, and thus
    // no per-proof account to create, reference, or later close.
    let equality_ix = ProofInstruction::VerifyCiphertextCommitmentEquality
        .encode_verify_proof(None, &proof_data.equality_proof_data);
    let validity_ix = ProofInstruction::VerifyBatchedGroupedCiphertext3HandlesValidity
        .encode_verify_proof(
            None,
            &proof_data
                .ciphertext_validity_proof_data_with_ciphertext
                .proof_data,
        );
    let range_ix = ProofInstruction::VerifyBatchedRangeProofU128
        .encode_verify_proof(None, &proof_data.range_proof_data);

    let transfer_ix = inner_transfer(
        &spl_token_2022::id(),
        &sender_token_account,
        mint,
        &recipient_token_account,
        &new_decryptable,
        &proof_data
            .ciphertext_validity_proof_data_with_ciphertext
            .ciphertext_lo,
        &proof_data
            .ciphertext_validity_proof_data_with_ciphertext
            .ciphertext_hi,
        &sender.pubkey(),
        &[],
        ProofLocation::InstructionOffset(
            std::num::NonZeroI8::new(-3).unwrap(),
            &proof_data.equality_proof_data,
        ),
        ProofLocation::InstructionOffset(
            std::num::NonZeroI8::new(-2).unwrap(),
            &proof_data
                .ciphertext_validity_proof_data_with_ciphertext
                .proof_data,
        ),
        ProofLocation::InstructionOffset(
            std::num::NonZeroI8::new(-1).unwrap(),
            &proof_data.range_proof_data,
        ),
    )?;

    let ixs = [equality_ix, validity_ix, range_ix, transfer_ix];

    let blockhash = client.get_latest_blockhash()?;
    let message = v1::Message::try_compile_with_config(
        &payer.pubkey(),
        &ixs,
        blockhash,
        v1::TransactionConfig::empty()
            .with_compute_unit_limit(COMPUTE_UNIT_LIMIT)
            .with_loaded_accounts_data_size_limit(LOADED_ACCOUNTS_DATA_SIZE_LIMIT),
    )?;
    let tx = VersionedTransaction::try_new(VersionedMessage::V1(message), &[payer, sender])?;

    Ok(BuiltTransfer {
        tx,
        auditor_ciphertext_lo_hex,
        auditor_ciphertext_hi_hex,
    })
}

/// Build, sign, submit and confirm one confidential transfer.
pub fn transfer_confidential(
    client: &RpcClient,
    payer: &dyn Signer,
    sender: &Keypair,
    mint: &Pubkey,
    recipient: &Pubkey,
    amount: u64,
) -> CtResult<TransferOutcome> {
    let built = build_transfer(client, payer, sender, mint, recipient, amount)?;
    let sig: Signature = client.send_and_confirm_transaction(&built.tx)?;

    Ok(TransferOutcome {
        steps: vec![LabeledSignature::new("submit_transfer_v1", &sig)],
        auditor_ciphertext_lo_hex: built.auditor_ciphertext_lo_hex,
        auditor_ciphertext_hi_hex: built.auditor_ciphertext_hi_hex,
    })
}

/// Build the real transaction — proofs and all — and ask the cluster to
/// simulate it without submitting. This is the same code path a real send
/// takes right up to `send_and_confirm_transaction`, so the verdict covers
/// what an approximation can't: proof verification actually passing, the
/// compute budget actually sufficing, the accounts actually being configured.
pub fn simulate_transfer(
    client: &RpcClient,
    payer: &dyn Signer,
    sender: &Keypair,
    mint: &Pubkey,
    recipient: &Pubkey,
    amount: u64,
) -> CtResult<TransferSimulation> {
    let built = build_transfer(client, payer, sender, mint, recipient, amount)?;
    let sim = client.simulate_transaction(&built.tx)?.value;
    let fee_lamports = match &built.tx.message {
        VersionedMessage::V1(message) => fee_for_v1_message(client, message),
        _ => None,
    };

    Ok(TransferSimulation {
        success: sim.err.is_none(),
        error: sim.err.map(|e| e.to_string()),
        logs: sim.logs.unwrap_or_default(),
        units_consumed: sim.units_consumed,
        fee_lamports,
    })
}

/// `RpcClient::get_fee_for_message` can't be used here: its
/// `SerializableMessage` bound is implemented for legacy and v0 messages only
/// — there's no V1 impl as of solana-rpc-client 4.4.0-alpha.3, even though the
/// same client sends V1 transactions fine. So issue the identical JSON-RPC
/// call it would have made, base64-encoding the V1 message ourselves. Returns
/// `None` rather than failing the whole simulation if the node declines (e.g.
/// the blockhash aged out between building and asking).
fn fee_for_v1_message(client: &RpcClient, message: &v1::Message) -> Option<u64> {
    let encoded = BASE64_STANDARD.encode(message.serialize());
    client
        .send::<RpcResponse<Option<u64>>>(
            RpcRequest::GetFeeForMessage,
            serde_json::json!([encoded, client.commitment()]),
        )
        .ok()
        .and_then(|response| response.value)
}
