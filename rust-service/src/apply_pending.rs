//! Apply pending confidential balance to available confidential balance.
//!
//! Decrypts pending + available balances client-side, re-encrypts the new
//! available balance with AES, and submits `ApplyPendingBalance`. No ZK proof
//! is required for this instruction.
//!
//! Adapted from solana-foundation/Confidential-Balances-Sample.

use crate::ata::get_associated_token_address_with_program_id;
use crate::types::*;
use solana_client::rpc_client::RpcClient;
use solana_sdk::{signature::Signer, transaction::Transaction};
use solana_zk_sdk::encryption::{auth_encryption::AeKey, elgamal::ElGamalKeypair};
use solana_zk_sdk_pod::encryption::{
    auth_encryption::PodAeCiphertext as PodAeCiphertextLegacy,
    elgamal::PodElGamalCiphertext as PodElGamalCiphertextV6,
};
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

pub async fn apply_pending_balance(
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

    let elgamal_keypair =
        ElGamalKeypair::new_from_signer_legacy(authority, &token_account.to_bytes())
            .map_err(|e| format!("derive ElGamal keypair: {e}"))?;
    let aes_key = AeKey::new_from_signer_legacy(authority, &token_account.to_bytes())
        .map_err(|e| format!("derive AES key: {e}"))?;

    let account_data = client.get_account(&token_account)?;
    let account = StateWithExtensions::<TokenAccount>::unpack(&account_data.data)?;
    let ct_extension = account.get_extension::<ConfidentialTransferAccount>()?;

    let pending_lo_v6: PodElGamalCiphertextV6 = PodElGamalCiphertextV6(
        bytemuck::bytes_of(&ct_extension.pending_balance_lo)
            .try_into()
            .map_err(|_| "pending_balance_lo size")?,
    );
    let pending_hi_v6: PodElGamalCiphertextV6 = PodElGamalCiphertextV6(
        bytemuck::bytes_of(&ct_extension.pending_balance_hi)
            .try_into()
            .map_err(|_| "pending_balance_hi size")?,
    );
    let available_v6: PodElGamalCiphertextV6 = PodElGamalCiphertextV6(
        bytemuck::bytes_of(&ct_extension.available_balance)
            .try_into()
            .map_err(|_| "available_balance size")?,
    );

    let pending_lo: solana_zk_sdk::encryption::elgamal::ElGamalCiphertext =
        pending_lo_v6.try_into().map_err(|e| format!("{e:?}"))?;
    let pending_hi: solana_zk_sdk::encryption::elgamal::ElGamalCiphertext =
        pending_hi_v6.try_into().map_err(|e| format!("{e:?}"))?;
    let available_balance: solana_zk_sdk::encryption::elgamal::ElGamalCiphertext =
        available_v6.try_into().map_err(|e| format!("{e:?}"))?;

    let pending_lo_amount = pending_lo
        .decrypt_u32(elgamal_keypair.secret())
        .ok_or("decrypt pending_balance_lo")?;
    let pending_hi_amount = pending_hi
        .decrypt_u32(elgamal_keypair.secret())
        .ok_or("decrypt pending_balance_hi")?;
    let current_available = available_balance
        .decrypt_u32(elgamal_keypair.secret())
        .ok_or("decrypt available_balance")?;

    let pending_total = (pending_lo_amount as u64) + ((pending_hi_amount as u64) << 16);
    let new_available = (current_available as u64) + pending_total;

    let new_decryptable_v6 = aes_key.encrypt(new_available);
    let new_decryptable_legacy: PodAeCiphertextLegacy =
        PodAeCiphertextLegacy::from(new_decryptable_v6.to_bytes());

    let expected_counter: u64 = ct_extension.pending_balance_credit_counter.into();

    let apply_ix = apply_pending_balance_instruction(
        &spl_token_2022::id(),
        &token_account,
        expected_counter,
        &new_decryptable_legacy,
        &authority.pubkey(),
        &[&authority.pubkey()],
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
