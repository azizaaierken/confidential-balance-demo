//! Mint-level operations: create the confidential-transfer mint, mint
//! additional public supply, and rotate the mint-level auditor ElGamal key.
//!
//! Adapted from solana-foundation/Confidential-Balances-Sample's demo-server.

use crate::types::*;
use solana_client::rpc_client::RpcClient;
use solana_sdk::{
    pubkey::Pubkey,
    signature::{Signature, Signer},
    transaction::Transaction,
};
use solana_system_interface::instruction as system_instruction;
use solana_zk_sdk::encryption::elgamal::ElGamalKeypair;
use solana_zk_sdk_pod::encryption::elgamal::PodElGamalPubkey as PodElGamalPubkeyV6;
use spl_associated_token_account::get_associated_token_address_with_program_id;
use spl_token_2022::{
    extension::{
        confidential_transfer::{
            instruction::{
                initialize_mint as initialize_confidential_transfer_mint,
                update_mint as update_confidential_transfer_mint,
            },
            ConfidentialTransferAccount, ConfidentialTransferMint,
        },
        BaseStateWithExtensions, ExtensionType, StateWithExtensions,
    },
    instruction::{initialize_mint as initialize_mint_base, mint_to},
    solana_zk_sdk::encryption::pod::elgamal::PodElGamalPubkey as PodElGamalPubkeyLegacy,
    state::{Account as TokenAccount, Mint},
};

/// 6.0.1 ElGamal pubkey -> the legacy 4.0-shaped POD type spl-token-2022's
/// instruction builders expect. Wire format is identical (32 bytes).
pub fn to_legacy_pubkey(kp: &ElGamalKeypair) -> PodElGamalPubkeyLegacy {
    let v6: PodElGamalPubkeyV6 = (*kp.pubkey()).into();
    PodElGamalPubkeyLegacy::from(v6.0)
}

pub fn mint_exists(rpc: &RpcClient, mint: &Pubkey) -> CtResult<bool> {
    match rpc.get_account(mint) {
        Ok(_) => Ok(true),
        Err(e) => {
            if e.to_string().contains("AccountNotFound") {
                Ok(false)
            } else {
                Err(format!("rpc get_account failed: {e}").into())
            }
        }
    }
}

pub fn ata_is_configured(rpc: &RpcClient, ata: &Pubkey) -> CtResult<bool> {
    let data = match rpc.get_account(ata) {
        Ok(a) => a,
        Err(e) if e.to_string().contains("AccountNotFound") => return Ok(false),
        Err(e) => return Err(format!("rpc get_account failed: {e}").into()),
    };
    let acc = StateWithExtensions::<TokenAccount>::unpack(&data.data)
        .map_err(|e| format!("ATA exists but is not Token-2022: {e}"))?;
    Ok(acc.get_extension::<ConfidentialTransferAccount>().is_ok())
}

pub async fn create_confidential_mint(
    client: &RpcClient,
    payer: &dyn Signer,
    mint: &dyn Signer,
    mint_authority: &dyn Signer,
    decimals: u8,
    auditor_elgamal: &ElGamalKeypair,
) -> SigResult {
    let space =
        ExtensionType::try_calculate_account_len::<Mint>(&[ExtensionType::ConfidentialTransferMint])?;
    let rent = client.get_minimum_balance_for_rent_exemption(space)?;
    let auditor_pod = to_legacy_pubkey(auditor_elgamal);

    let create_ix = system_instruction::create_account(
        &payer.pubkey(),
        &mint.pubkey(),
        rent,
        space as u64,
        &spl_token_2022::id(),
    );
    let init_ct_ix = initialize_confidential_transfer_mint(
        &spl_token_2022::id(),
        &mint.pubkey(),
        Some(mint_authority.pubkey()),
        true, // auto-approve new accounts
        Some(auditor_pod),
    )?;
    let init_mint_ix = initialize_mint_base(
        &spl_token_2022::id(),
        &mint.pubkey(),
        &mint_authority.pubkey(),
        None,
        decimals,
    )?;

    let blockhash = client.get_latest_blockhash()?;
    let tx = Transaction::new_signed_with_payer(
        &[create_ix, init_ct_ix, init_mint_ix],
        Some(&payer.pubkey()),
        &[payer, mint],
        blockhash,
    );
    Ok(client.send_and_confirm_transaction(&tx)?)
}

/// Update the mint's auditor ElGamal pubkey (auditor-key rotation). Does not
/// touch `auto_approve_new_accounts`, which is re-sent unchanged.
pub async fn rotate_auditor_key(
    client: &RpcClient,
    payer: &dyn Signer,
    mint: &Pubkey,
    mint_authority: &dyn Signer,
    new_auditor_elgamal: &ElGamalKeypair,
) -> SigResult {
    let auditor_pod = to_legacy_pubkey(new_auditor_elgamal);
    let ix = update_confidential_transfer_mint(
        &spl_token_2022::id(),
        mint,
        &mint_authority.pubkey(),
        &[],
        true,
        Some(auditor_pod),
    )?;
    let blockhash = client.get_latest_blockhash()?;
    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &[payer, mint_authority],
        blockhash,
    );
    Ok(client.send_and_confirm_transaction(&tx)?)
}

pub fn mint_additional_supply(
    client: &RpcClient,
    payer: &dyn Signer,
    mint: &Pubkey,
    mint_authority: &dyn Signer,
    recipient_owner: &Pubkey,
    amount_base: u64,
) -> SigResult {
    let recipient_ata =
        get_associated_token_address_with_program_id(recipient_owner, mint, &spl_token_2022::id());
    let ix = mint_to(
        &spl_token_2022::id(),
        mint,
        &recipient_ata,
        &mint_authority.pubkey(),
        &[],
        amount_base,
    )?;
    let blockhash = client.get_latest_blockhash()?;
    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &[payer, mint_authority],
        blockhash,
    );
    Ok(client.send_and_confirm_transaction(&tx)?)
}

/// Read the mint's on-chain `supply` field directly — this is the
/// authoritative total-supply figure. It does not change when tokens move
/// between public, pending, and available confidential state; only minting
/// changes it.
pub fn read_total_supply(client: &RpcClient, mint: &Pubkey) -> CtResult<u64> {
    let data = client.get_account(mint)?;
    let acc = StateWithExtensions::<Mint>::unpack(&data.data)?;
    Ok(acc.base.supply)
}

pub fn read_auditor_pubkey_legacy(
    client: &RpcClient,
    mint: &Pubkey,
) -> CtResult<Option<PodElGamalPubkeyLegacy>> {
    let data = client.get_account(mint)?;
    let acc = StateWithExtensions::<Mint>::unpack(&data.data)?;
    let ext = acc.get_extension::<ConfidentialTransferMint>()?;
    Ok(ext.auditor_elgamal_pubkey.into())
}

/// Signature is unused by callers today but kept for parity with the other
/// operation modules, which all return the confirming signature.
#[allow(dead_code)]
pub type MintSignature = Signature;
