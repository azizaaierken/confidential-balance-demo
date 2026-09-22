//! Mint-level operations: create the confidential-transfer mint, mint
//! additional public supply, and rotate the mint-level auditor ElGamal key.
//!
//! Adapted from solana-foundation/Confidential-Balances-Sample's demo-server.

use crate::ata::get_associated_token_address_with_program_id;
use crate::types::*;
use solana_client::rpc_client::RpcClient;
use solana_sdk::{pubkey::Pubkey, signature::Signer, transaction::Transaction};
use solana_system_interface::instruction as system_instruction;
use solana_zk_sdk::encryption::elgamal::ElGamalKeypair;
use solana_zk_sdk_pod::encryption::elgamal::PodElGamalPubkey;
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
    state::{Account as TokenAccount, Mint},
};

/// The mint extension's `auditor_elgamal_pubkey` is stored as a POD pubkey.
fn auditor_pod_pubkey(kp: &ElGamalKeypair) -> PodElGamalPubkey {
    (*kp.pubkey()).into()
}

pub fn mint_exists(rpc: &RpcClient, mint: &Pubkey) -> CtResult<bool> {
    match rpc.get_account(mint) {
        Ok(_) => Ok(true),
        Err(e) if e.to_string().contains("AccountNotFound") => Ok(false),
        Err(e) => Err(format!("rpc get_account failed: {e}").into()),
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

/// The mint's confidential-transfer configuration as it stands on chain.
pub struct ConfidentialMintConfig {
    pub authority: Option<Pubkey>,
    pub auto_approve_new_accounts: bool,
    pub auditor_elgamal_pubkey: Option<String>,
}

pub fn read_confidential_mint_config(
    client: &RpcClient,
    mint: &Pubkey,
) -> CtResult<ConfidentialMintConfig> {
    let data = client.get_account(mint)?;
    decode_confidential_mint_config(&data.data)
}

pub fn decode_confidential_mint_config(data: &[u8]) -> CtResult<ConfidentialMintConfig> {
    let acc = StateWithExtensions::<Mint>::unpack(data)?;
    let ext = acc.get_extension::<ConfidentialTransferMint>()?;
    let authority: Option<Pubkey> = ext.authority.into();
    let auditor: Option<PodElGamalPubkey> = ext.auditor_elgamal_pubkey.into();
    Ok(ConfidentialMintConfig {
        authority,
        auto_approve_new_accounts: ext.auto_approve_new_accounts.into(),
        auditor_elgamal_pubkey: auditor.map(|p| p.to_string()),
    })
}

pub fn create_confidential_mint(
    client: &RpcClient,
    payer: &dyn Signer,
    mint: &dyn Signer,
    mint_authority: &dyn Signer,
    decimals: u8,
    auditor_elgamal: &ElGamalKeypair,
) -> SigResult {
    let space = ExtensionType::try_calculate_account_len::<Mint>(&[
        ExtensionType::ConfidentialTransferMint,
    ])?;
    let rent = client.get_minimum_balance_for_rent_exemption(space)?;

    let create_ix = system_instruction::create_account(
        &payer.pubkey(),
        &mint.pubkey(),
        rent,
        space as u64,
        &spl_token_2022::id(),
    );
    // Extension initialisation must precede the base `InitializeMint`.
    let init_ct_ix = initialize_confidential_transfer_mint(
        &spl_token_2022::id(),
        &mint.pubkey(),
        Some(mint_authority.pubkey()),
        true, // auto-approve new accounts
        Some(auditor_pod_pubkey(auditor_elgamal)),
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
pub fn rotate_auditor_key(
    client: &RpcClient,
    payer: &dyn Signer,
    mint: &Pubkey,
    mint_authority: &dyn Signer,
    new_auditor_elgamal: &ElGamalKeypair,
) -> SigResult {
    let ix = update_confidential_transfer_mint(
        &spl_token_2022::id(),
        mint,
        &mint_authority.pubkey(),
        &[],
        true,
        Some(auditor_pod_pubkey(new_auditor_elgamal)),
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
    decode_total_supply(&data.data)
}

pub fn decode_total_supply(data: &[u8]) -> CtResult<u64> {
    let acc = StateWithExtensions::<Mint>::unpack(data)?;
    Ok(acc.base.supply)
}
