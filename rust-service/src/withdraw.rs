//! Withdraw tokens from confidential balance to public balance (bypass mode).
//!
//! Generates the equality + range proofs, pre-verifies each into a context
//! state account, then references those accounts in `spl-token-2022`'s
//! withdraw instruction via `ProofLocation::ContextStateAccount`.
//!
//! Adapted from solana-foundation/Confidential-Balances-Sample.

use crate::types::*;
use solana_address::Address;
use solana_client::rpc_client::RpcClient;
use solana_sdk::{
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::Transaction,
};
use solana_system_interface::instruction as system_instruction;
use solana_zk_elgamal_proof_interface::{
    instruction::{close_context_state, ContextStateInfo, ProofInstruction},
    proof_data::{BatchedRangeProofContext, CiphertextCommitmentEqualityProofContext},
    state::ProofContextState,
};
use solana_zk_sdk::encryption::{
    auth_encryption::AeKey,
    elgamal::{ElGamalCiphertext, ElGamalKeypair},
};
use solana_zk_sdk_pod::encryption::elgamal::PodElGamalCiphertext as PodElGamalCiphertextV6;
use spl_associated_token_account::get_associated_token_address_with_program_id;
use spl_token_2022::{
    extension::{
        confidential_transfer::{
            instruction::{
                withdraw, BatchedRangeProofU64Data, CiphertextCommitmentEqualityProofData,
            },
            ConfidentialTransferAccount,
        },
        BaseStateWithExtensions, StateWithExtensions,
    },
    solana_zk_sdk::encryption::pod::auth_encryption::PodAeCiphertext as PodAeCiphertextLegacy,
    state::Account as TokenAccount,
};
use spl_token_confidential_transfer_proof_extraction::instruction::ProofLocation;
use spl_token_confidential_transfer_proof_generation::withdraw::withdraw_proof_data;
use std::mem::size_of;

use crate::proof_staging::{stage_proof_record, RECORD_PROOF_OFFSET};

const ZK_PROOF_PROGRAM_ID: Pubkey =
    solana_sdk::pubkey!("ZkE1Gama1Proof11111111111111111111111111111");

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

    let elgamal_keypair = ElGamalKeypair::new_from_signer(authority, &token_account.to_bytes())
        .map_err(|e| format!("derive ElGamal keypair: {e}"))?;
    let aes_key = AeKey::new_from_signer(authority, &token_account.to_bytes())
        .map_err(|e| format!("derive AES key: {e}"))?;

    let account_data = client.get_account(&token_account)?;
    let account = StateWithExtensions::<TokenAccount>::unpack(&account_data.data)?;
    let ct_extension = account.get_extension::<ConfidentialTransferAccount>()?;

    let available_v6: PodElGamalCiphertextV6 = PodElGamalCiphertextV6(
        bytemuck::bytes_of(&ct_extension.available_balance)
            .try_into()
            .map_err(|_| "available_balance size")?,
    );
    let available_balance: ElGamalCiphertext = available_v6
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
    let new_decryptable_v6 = aes_key.encrypt(new_available);
    let new_decryptable_legacy: PodAeCiphertextLegacy =
        PodAeCiphertextLegacy::from(new_decryptable_v6.to_bytes());

    // ----- Pre-verify equality proof into a context state account -----
    let equality_account = Keypair::new();
    let equality_size = size_of::<ProofContextState<CiphertextCommitmentEqualityProofContext>>();
    let equality_rent = client.get_minimum_balance_for_rent_exemption(equality_size)?;
    let equality_create_ix = system_instruction::create_account(
        &payer.pubkey(),
        &equality_account.pubkey(),
        equality_rent,
        equality_size as u64,
        &ZK_PROOF_PROGRAM_ID,
    );
    let equality_verify_ix = ProofInstruction::VerifyCiphertextCommitmentEquality
        .encode_verify_proof(
            Some(ContextStateInfo {
                context_state_account: &Address::from(equality_account.pubkey().to_bytes()),
                context_state_authority: &Address::from(authority.pubkey().to_bytes()),
            }),
            &proof_data.equality_proof_data,
        );

    let mut steps: Vec<LabeledSignature> = Vec::new();
    let blockhash = client.get_latest_blockhash()?;
    let tx = Transaction::new_signed_with_payer(
        &[equality_create_ix, equality_verify_ix],
        Some(&payer.pubkey()),
        &[payer, &equality_account],
        blockhash,
    );
    let sig = client.send_and_confirm_transaction(&tx)?;
    steps.push(LabeledSignature::new("verify_equality_proof", &sig));

    // ----- Pre-verify range proof into a context state account -----
    // The U64 range proof plus its own context-account creation doesn't fit
    // in a single legacy (1232-byte) transaction either (confirmed on
    // devnet), so it's staged through an spl-record account exactly like the
    // confidential-transfer's U128 range proof.
    let record_account = Keypair::new();
    let range_account = Keypair::new();
    let range_size = size_of::<ProofContextState<BatchedRangeProofContext>>();
    let range_rent = client.get_minimum_balance_for_rent_exemption(range_size)?;
    let range_create_ix = system_instruction::create_account(
        &payer.pubkey(),
        &range_account.pubkey(),
        range_rent,
        range_size as u64,
        &ZK_PROOF_PROGRAM_ID,
    );
    let range_verify_ix = ProofInstruction::VerifyBatchedRangeProofU64
        .encode_verify_proof_from_account(
            Some(ContextStateInfo {
                context_state_account: &Address::from(range_account.pubkey().to_bytes()),
                context_state_authority: &Address::from(authority.pubkey().to_bytes()),
            }),
            &Address::from(record_account.pubkey().to_bytes()),
            RECORD_PROOF_OFFSET,
        );
    let record_sigs = stage_proof_record(
        client,
        payer,
        &record_account,
        bytemuck::bytes_of(&proof_data.range_proof_data),
        &[range_create_ix, range_verify_ix],
        &[&range_account],
    )?;
    for (i, sig) in record_sigs.iter().enumerate() {
        steps.push(LabeledSignature::with_part(
            "range_proof_stage",
            sig,
            (i + 1) as u32,
        ));
    }

    // ----- Submit the withdraw ix referencing both context state accounts -----
    let equality_loc: ProofLocation<CiphertextCommitmentEqualityProofData> =
        ProofLocation::ContextStateAccount(&equality_account.pubkey());
    let range_loc: ProofLocation<BatchedRangeProofU64Data> =
        ProofLocation::ContextStateAccount(&range_account.pubkey());

    let withdraw_ixs = withdraw(
        &spl_token_2022::id(),
        &token_account,
        mint,
        amount,
        decimals,
        &new_decryptable_legacy,
        &authority.pubkey(),
        &[&authority.pubkey()],
        equality_loc,
        range_loc,
    )?;

    let blockhash = client.get_latest_blockhash()?;
    let tx = Transaction::new_signed_with_payer(
        &withdraw_ixs,
        Some(&payer.pubkey()),
        &[payer, authority],
        blockhash,
    );
    let withdraw_sig = client.send_and_confirm_transaction(&tx)?;
    steps.push(LabeledSignature::new("submit_withdraw", &withdraw_sig));

    // ----- Close the proof context state accounts + the record account -----
    let close_labels = ["close_equality_proof", "close_range_proof"];
    for (account, label) in [&equality_account, &range_account].into_iter().zip(close_labels) {
        let close_ix = close_context_state(
            ContextStateInfo {
                context_state_account: &Address::from(account.pubkey().to_bytes()),
                context_state_authority: &Address::from(authority.pubkey().to_bytes()),
            },
            &Address::from(payer.pubkey().to_bytes()),
        );
        let blockhash = client.get_latest_blockhash()?;
        let tx = Transaction::new_signed_with_payer(
            &[close_ix],
            Some(&payer.pubkey()),
            &[payer, authority],
            blockhash,
        );
        let sig = client.send_and_confirm_transaction(&tx)?;
        steps.push(LabeledSignature::new(label, &sig));
    }
    let close_record_ix = spl_record::instruction::close_account(
        &record_account.pubkey(),
        &payer.pubkey(),
        &payer.pubkey(),
    );
    let blockhash = client.get_latest_blockhash()?;
    let tx = Transaction::new_signed_with_payer(
        &[close_record_ix],
        Some(&payer.pubkey()),
        &[payer],
        blockhash,
    );
    let sig = client.send_and_confirm_transaction(&tx)?;
    steps.push(LabeledSignature::new("close_proof_record", &sig));

    Ok(WithdrawOutcome { steps })
}
