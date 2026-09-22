//! Apply pending confidential balance to available confidential balance.
//!
//! Decrypts pending + available balances client-side, re-encrypts the new
//! available balance with AES, and submits `ApplyPendingBalance`. No ZK proof
//! is required for this instruction.
//!
//! Adapted from solana-foundation/Confidential-Balances-Sample.

use crate::ata::get_associated_token_address_with_program_id;
use crate::keys;
use crate::types::*;
use solana_client::rpc_client::RpcClient;
use solana_sdk::{signature::Signer, transaction::Transaction};
use solana_zk_sdk::encryption::{auth_encryption::AeCiphertext, elgamal::ElGamalCiphertext};
use spl_token_2022::{
    extension::{
        confidential_transfer::{
            instruction::apply_pending_balance as apply_pending_balance_instruction,
            ConfidentialTransferAccount,
        },
        BaseStateWithExtensions, StateWithExtensions,
    },
    state::Account as TokenAccount,
};

/// Signature plus the pending amount that was moved into available balance
/// (for activity-log purposes — this instruction returns no amount on-chain).
pub struct ApplyPendingOutcome {
    pub signature: solana_sdk::signature::Signature,
    pub applied_amount: u64,
    pub new_available: u64,
}

pub fn apply_pending_balance(
    client: &RpcClient,
    payer: &dyn Signer,
    authority: &dyn Signer,
    mint: &solana_sdk::pubkey::Pubkey,
) -> CtResult<ApplyPendingOutcome> {
    let token_account = get_associated_token_address_with_program_id(
        &authority.pubkey(),
        mint,
        &spl_token_2022::id(),
    );
    let (elgamal_keypair, aes_key) = keys::derive_account_keys(authority, &token_account)?;

    let account_data = client.get_account(&token_account)?;
    let account = StateWithExtensions::<TokenAccount>::unpack(&account_data.data)?;
    let ct_extension = account.get_extension::<ConfidentialTransferAccount>()?;

    // Pending halves are ElGamal-only (credited homomorphically by the
    // program), so they need the discrete-log decryption; the available
    // balance has the owner's own AES copy, so read that directly.
    let pending_lo: ElGamalCiphertext = ct_extension
        .pending_balance_lo
        .try_into()
        .map_err(|e| format!("decode pending_balance_lo: {e:?}"))?;
    let pending_hi: ElGamalCiphertext = ct_extension
        .pending_balance_hi
        .try_into()
        .map_err(|e| format!("decode pending_balance_hi: {e:?}"))?;
    let decryptable: AeCiphertext = ct_extension
        .decryptable_available_balance
        .try_into()
        .map_err(|e| format!("decode decryptable_available_balance: {e:?}"))?;

    let pending_lo_amount = pending_lo
        .decrypt_u32(elgamal_keypair.secret())
        .ok_or("decrypt pending_balance_lo: derived ElGamal key does not match this account")?;
    let pending_hi_amount = pending_hi
        .decrypt_u32(elgamal_keypair.secret())
        .ok_or("decrypt pending_balance_hi: derived ElGamal key does not match this account")?;
    let current_available = aes_key
        .decrypt(&decryptable)
        .ok_or("decrypt available balance: derived AES key does not match this account")?;

    let pending_total = pending_lo_amount + (pending_hi_amount << 16);
    let new_available = current_available + pending_total;
    let new_decryptable = aes_key.encrypt(new_available).into();

    let expected_counter: u64 = ct_extension.pending_balance_credit_counter.into();

    let apply_ix = apply_pending_balance_instruction(
        &spl_token_2022::id(),
        &token_account,
        expected_counter,
        &new_decryptable,
        &authority.pubkey(),
        &[],
    )?;

    let recent_blockhash = client.get_latest_blockhash()?;
    let transaction = Transaction::new_signed_with_payer(
        &[apply_ix],
        Some(&payer.pubkey()),
        &[payer, authority],
        recent_blockhash,
    );

    let signature = client.send_and_confirm_transaction(&transaction)?;
    Ok(ApplyPendingOutcome {
        signature,
        applied_amount: pending_total,
        new_available,
    })
}
