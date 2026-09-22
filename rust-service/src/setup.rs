//! Idempotent environment setup shared by the `bootstrap`/`spike` binaries
//! and the HTTP server's own startup: load (or generate) every keypair this
//! demo needs, airdrop the payer if it's dry, create the confidential mint if
//! it doesn't exist yet, and configure both personas' token accounts for
//! confidential transfers if they aren't already.

use crate::ata::{
    create_associated_token_account_idempotent, get_associated_token_address_with_program_id,
};
use crate::{keys, mint, types::CtResult};
use solana_client::rpc_client::RpcClient;
use solana_commitment_config::CommitmentConfig;
use solana_sdk::signature::{Keypair, Signer};
use solana_zk_sdk::encryption::elgamal::ElGamalKeypair;

pub const MINT_DECIMALS: u8 = 2;

pub struct Env {
    pub rpc: RpcClient,
    pub payer: Keypair,
    pub mint: Keypair,
    pub mint_authority: Keypair,
    pub sender: Keypair,
    pub receiver: Keypair,
    /// Active auditor-key generation: the Ed25519 signer whose signature
    /// (over the mint's pubkey bytes) deterministically derives the auditor's
    /// ElGamal keypair. A new generation means a new signer keypair file.
    pub auditor_authority: Keypair,
    pub auditor_generation: u32,
    pub auditor_elgamal: ElGamalKeypair,
}

pub fn rpc_url() -> String {
    std::env::var("SOLANA_RPC_URL").unwrap_or_else(|_| "https://api.devnet.solana.com".to_string())
}

/// Which auditor generation file is "active" right now — tracked as a plain
/// number in its own small file so rotation just has to bump it and generate
/// the next `auditor-gen-N.json`. Retired generations' files are never
/// deleted, so old ciphertexts stay decryptable per CB-08's retention
/// requirement.
pub fn active_auditor_generation() -> CtResult<u32> {
    let path = keys::keys_dir().join("active-auditor-generation.txt");
    if path.exists() {
        let raw = std::fs::read_to_string(&path)?;
        Ok(raw.trim().parse().unwrap_or(1))
    } else {
        std::fs::create_dir_all(keys::keys_dir())?;
        std::fs::write(&path, "1")?;
        Ok(1)
    }
}

pub fn set_active_auditor_generation(gen: u32) -> CtResult<()> {
    let path = keys::keys_dir().join("active-auditor-generation.txt");
    std::fs::write(&path, gen.to_string())?;
    Ok(())
}

pub fn load_auditor_generation(
    gen: u32,
    mint: &solana_sdk::pubkey::Pubkey,
) -> CtResult<(Keypair, ElGamalKeypair)> {
    let authority = keys::load_or_generate(&format!("auditor-gen-{gen}"))?;
    let elgamal = ElGamalKeypair::new_from_signer_legacy(&authority, &mint.to_bytes())
        .map_err(|e| format!("derive auditor ElGamal keypair: {e}"))?;
    Ok((authority, elgamal))
}

pub async fn load_or_bootstrap() -> CtResult<Env> {
    let rpc = RpcClient::new_with_commitment(rpc_url(), CommitmentConfig::confirmed());

    let payer = keys::load_or_generate("payer")?;
    let mint = keys::load_or_generate("mint")?;
    let mint_authority = keys::load_or_generate("mint-authority")?;
    let sender = keys::load_or_generate("sender")?;
    let receiver = keys::load_or_generate("receiver")?;

    let auditor_generation = active_auditor_generation()?;
    let (auditor_authority, auditor_elgamal) =
        load_auditor_generation(auditor_generation, &mint.pubkey())?;

    ensure_payer_funded(&rpc, &payer)?;

    if !mint::mint_exists(&rpc, &mint.pubkey())? {
        mint::create_confidential_mint(
            &rpc,
            &payer,
            &mint,
            &mint_authority,
            MINT_DECIMALS,
            &auditor_elgamal,
        )
        .await
        .map_err(|e| format!("create_confidential_mint: {e}"))?;
    }

    for authority in [&sender, &receiver] {
        ensure_confidential_account(&rpc, &payer, &mint.pubkey(), authority).await?;
    }

    Ok(Env {
        rpc,
        payer,
        mint,
        mint_authority,
        sender,
        receiver,
        auditor_authority,
        auditor_generation,
        auditor_elgamal,
    })
}

fn ensure_payer_funded(rpc: &RpcClient, payer: &Keypair) -> CtResult<()> {
    let lamports = rpc.get_balance(&payer.pubkey())?;
    if lamports >= 200_000_000 {
        return Ok(());
    }
    let sig = rpc.request_airdrop(&payer.pubkey(), 1_000_000_000)?;
    for _ in 0..30 {
        if rpc.confirm_transaction(&sig).unwrap_or(false) {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(1000));
    }
    Err(format!(
        "airdrop to payer {} did not confirm in time — fund it manually: solana airdrop 2 {} --url {}",
        payer.pubkey(),
        payer.pubkey(),
        rpc.url()
    )
    .into())
}

async fn ensure_confidential_account(
    rpc: &RpcClient,
    payer: &Keypair,
    mint: &solana_sdk::pubkey::Pubkey,
    authority: &Keypair,
) -> CtResult<()> {
    let ata = get_associated_token_address_with_program_id(
        &authority.pubkey(),
        mint,
        &spl_token_2022::id(),
    );
    if mint::ata_is_configured(rpc, &ata)? {
        return Ok(());
    }

    let ata_ix = create_associated_token_account_idempotent(
        &payer.pubkey(),
        &authority.pubkey(),
        mint,
        &spl_token_2022::id(),
    );
    let blockhash = rpc.get_latest_blockhash()?;
    let tx = solana_sdk::transaction::Transaction::new_signed_with_payer(
        &[ata_ix],
        Some(&payer.pubkey()),
        &[payer],
        blockhash,
    );
    rpc.send_and_confirm_transaction(&tx)?;

    crate::configure::configure_account_for_confidential_transfers(rpc, payer, authority, mint)
        .await
        .map_err(|e| format!("configure_account_for_confidential_transfers: {e}"))?;
    Ok(())
}
