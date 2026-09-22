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

/// A short label for the cluster behind `rpc_url()`, for display. Anything
/// that isn't recognisably one of the public clusters is reported as
/// `custom` rather than guessed.
pub fn cluster_label(url: &str) -> &'static str {
    if url.contains("devnet") {
        "devnet"
    } else if url.contains("testnet") {
        "testnet"
    } else if url.contains("mainnet") {
        "mainnet-beta"
    } else if url.contains("localhost") || url.contains("127.0.0.1") {
        "localnet"
    } else {
        "custom"
    }
}

fn active_generation_path() -> std::path::PathBuf {
    keys::keys_dir().join("active-auditor-generation.txt")
}

/// Which auditor generation file is "active" right now — tracked as a plain
/// number in its own small file so rotation just has to bump it and generate
/// the next `auditor-gen-N.json`. Retired generations' files are never
/// deleted, so old ciphertexts stay decryptable.
pub fn active_auditor_generation() -> CtResult<u32> {
    let path = active_generation_path();
    if path.exists() {
        let raw = std::fs::read_to_string(&path)?;
        raw.trim()
            .parse()
            .map_err(|e| format!("{}: not a generation number: {e}", path.display()).into())
    } else {
        std::fs::create_dir_all(keys::keys_dir())?;
        std::fs::write(&path, "1")?;
        Ok(1)
    }
}

pub fn set_active_auditor_generation(gen: u32) -> CtResult<()> {
    std::fs::write(active_generation_path(), gen.to_string())?;
    Ok(())
}

pub fn auditor_key_name(gen: u32) -> String {
    format!("auditor-gen-{gen}")
}

pub fn load_auditor_generation(
    gen: u32,
    mint: &solana_sdk::pubkey::Pubkey,
) -> CtResult<(Keypair, ElGamalKeypair)> {
    let authority = keys::load_or_generate(&auditor_key_name(gen))?;
    let elgamal = keys::derive_auditor_elgamal(&authority, mint)?;
    Ok((authority, elgamal))
}

pub fn load_or_bootstrap() -> CtResult<Env> {
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
        .map_err(|e| format!("create_confidential_mint: {e}"))?;
    }

    for authority in [&sender, &receiver] {
        ensure_confidential_account(&rpc, &payer, &mint.pubkey(), authority)?;
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

/// Make sure the payer can cover bootstrap and a good run of demo
/// operations. Tries a devnet airdrop first, but the public faucet is
/// heavily rate-limited and often refuses outright, so the failure message
/// spells out the reliable alternative: a transfer from any wallet that
/// already holds devnet SOL.
fn ensure_payer_funded(rpc: &RpcClient, payer: &Keypair) -> CtResult<()> {
    let lamports = rpc.get_balance(&payer.pubkey())?;
    if lamports >= 200_000_000 {
        return Ok(());
    }
    let manual_hint = format!(
        "fund it from a wallet that already has devnet SOL, e.g. \
         `solana transfer --url devnet --allow-unfunded-recipient {} 2`, \
         or use https://faucet.solana.com, then re-run bootstrap",
        payer.pubkey()
    );
    let sig = match rpc.request_airdrop(&payer.pubkey(), 1_000_000_000) {
        Ok(sig) => sig,
        Err(e) => {
            return Err(format!(
                "airdrop to payer {} was refused ({e}); {manual_hint}",
                payer.pubkey()
            )
            .into())
        }
    };
    for _ in 0..30 {
        if rpc.confirm_transaction(&sig).unwrap_or(false) {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(1000));
    }
    Err(format!(
        "airdrop to payer {} did not confirm in time; {manual_hint}",
        payer.pubkey()
    )
    .into())
}

fn ensure_confidential_account(
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
        .map_err(|e| format!("configure_account_for_confidential_transfers: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::cluster_label;

    #[test]
    fn cluster_label_recognises_public_clusters() {
        assert_eq!(cluster_label("https://api.devnet.solana.com"), "devnet");
        assert_eq!(cluster_label("https://api.testnet.solana.com"), "testnet");
        assert_eq!(
            cluster_label("https://api.mainnet-beta.solana.com"),
            "mainnet-beta"
        );
        assert_eq!(cluster_label("http://127.0.0.1:8899"), "localnet");
        assert_eq!(cluster_label("https://rpc.example.com"), "custom");
    }
}
