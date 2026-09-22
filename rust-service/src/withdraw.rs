//! Withdraw tokens from confidential balance to public balance (bypass mode).
//!
//! Generates the equality + range proofs and submits them alongside the
//! withdraw instruction in a single V1 (SIMD-0385) transaction, via
//! `ProofLocation::InstructionOffset` — `withdraw()` itself appends the
//! proof-verify instructions right after the withdraw instruction when given
//! instruction-offset locations, so no separate context-state accounts (and
//! no spl-record staging for the range proof) are needed at all.
//!
//! Adapted from solana-foundation/Confidential-Balances-Sample.

use crate::ata::get_associated_token_address_with_program_id;
use crate::types::*;
use solana_client::rpc_client::RpcClient;
use solana_message::{v1, VersionedMessage};
use solana_sdk::{
    pubkey::Pubkey,
    signature::{Signature, Signer},
};
use solana_transaction::versioned::VersionedTransaction;
use solana_zk_sdk::encryption::{
    auth_encryption::AeKey,
    elgamal::{ElGamalCiphertext, ElGamalKeypair},
};
use spl_token_2022::extension::{
    confidential_transfer::{instruction::withdraw, ConfidentialTransferAccount},
    BaseStateWithExtensions, StateWithExtensions,
};
use spl_token_confidential_transfer_proof_extraction::instruction::ProofLocation;
use spl_token_confidential_transfer_proof_generation::withdraw::withdraw_proof_data;

/// Same reasoning as `transfer::COMPUTE_UNIT_LIMIT` — two ZK proof
/// verifications riding in the withdraw transaction easily clear the
/// no-ask-required 200,000 CU default.
const COMPUTE_UNIT_LIMIT: u32 = 1_400_000;

/// See `transfer::LOADED_ACCOUNTS_DATA_SIZE_LIMIT` — V1 requires this asked
/// for explicitly, or it defaults to 0 bytes rather than the legacy default.
const LOADED_ACCOUNTS_DATA_SIZE_LIMIT: u32 = 64 * 1024 * 1024;

pub async fn withdraw_from_confidential(
    client: &RpcClient,
    payer: &dyn Signer,
    authority: &dyn Signer,
    mint: &Pubkey,
    amount: u64,
    decimals: u8,
) -> CtResult<WithdrawOutcome> {
    let token_account = get_associated_token_address_with_program_id(
        &authority.pubkey(),
        mint,
        &spl_token_2022::id(),
    );

    let elgamal_keypair =
        ElGamalKeypair::new_from_signer_legacy(authority, &token_account.to_bytes())
            .map_err(|e| format!("derive ElGamal keypair: {e}"))?;
    let aes_key = AeKey::new_from_signer_legacy(authority, &token_account.to_bytes())
        .map_err(|e| format!("derive AES key: {e}"))?;

    let account_data = client.get_account(&token_account)?;
    let account =
        StateWithExtensions::<spl_token_2022::state::Account>::unpack(&account_data.data)?;
    let ct_extension = account.get_extension::<ConfidentialTransferAccount>()?;

    let available_balance: ElGamalCiphertext = ct_extension
        .available_balance
        .try_into()
        .map_err(|e| format!("decode available_balance: {e:?}"))?;

    let current_available = available_balance
        .decrypt_u32(elgamal_keypair.secret())
        .ok_or("decrypt available balance")? as u64;

    if current_available < amount {
        return Err(format!(
            "Insufficient confidential balance: have {}, need {}",
            current_available, amount
        )
        .into());
    }

    let proof_data = withdraw_proof_data(
        &available_balance,
        current_available,
        amount,
        &elgamal_keypair,
    )
    .map_err(|e| format!("withdraw_proof_data: {e}"))?;

    let new_available = current_available - amount;
    let new_decryptable = aes_key.encrypt(new_available).into();

    // `withdraw()` places the withdraw instruction first (offset 0) and, for
    // each `InstructionOffset` location, appends that proof's own verify
    // instruction immediately after in the same order — equality at offset
    // 1, range at offset 2 — building the full instruction list itself.
    let withdraw_ixs = withdraw(
        &spl_token_2022::id(),
        &token_account,
        mint,
        amount,
        decimals,
        &new_decryptable,
        &authority.pubkey(),
        &[],
        ProofLocation::InstructionOffset(
            std::num::NonZeroI8::new(1).unwrap(),
            &proof_data.equality_proof_data,
        ),
        ProofLocation::InstructionOffset(
            std::num::NonZeroI8::new(2).unwrap(),
            &proof_data.range_proof_data,
        ),
    )?;

    let blockhash = client.get_latest_blockhash()?;
    let message = v1::Message::try_compile_with_config(
        &payer.pubkey(),
        &withdraw_ixs,
        blockhash,
        v1::TransactionConfig::empty()
            .with_compute_unit_limit(COMPUTE_UNIT_LIMIT)
            .with_loaded_accounts_data_size_limit(LOADED_ACCOUNTS_DATA_SIZE_LIMIT),
    )?;
    let versioned_tx =
        VersionedTransaction::try_new(VersionedMessage::V1(message), &[payer, authority])?;
    let sig: Signature = client.send_and_confirm_transaction(&versioned_tx)?;

    Ok(WithdrawOutcome {
        steps: vec![LabeledSignature::new("submit_withdraw_v1", &sig)],
    })
}
