//! Local keypair persistence. Every signer this demo uses (payer, mint
//! authority, the two personas, and each auditor-key generation) is a plain
//! Ed25519 keypair held in a JSON file on this machine — never a browser
//! wallet. Files are created on first use and reused after that, so the same
//! devnet mint/accounts survive server restarts.

use anyhow::{Context, Result};
use solana_sdk::signature::Keypair;
use std::path::{Path, PathBuf};

pub fn keys_dir() -> PathBuf {
    let dir = std::env::var("RUST_SERVICE_KEYS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("keys"));
    dir
}

/// Load a keypair from `<keys_dir>/<name>.json`, generating and persisting a
/// new one if the file doesn't exist yet.
pub fn load_or_generate(name: &str) -> Result<Keypair> {
    let dir = keys_dir();
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("create keys dir {}", dir.display()))?;
    let path = dir.join(format!("{name}.json"));
    load_or_generate_at(&path)
}

pub fn load_or_generate_at(path: &Path) -> Result<Keypair> {
    if path.exists() {
        let raw = std::fs::read_to_string(path)
            .with_context(|| format!("read keypair file {}", path.display()))?;
        let bytes: Vec<u8> = serde_json::from_str(&raw)
            .with_context(|| format!("parse keypair file {}", path.display()))?;
        Keypair::try_from(bytes.as_slice())
            .map_err(|e| anyhow::anyhow!("keypair file {}: {e}", path.display()))
    } else {
        let kp = Keypair::new();
        save(path, &kp)?;
        Ok(kp)
    }
}

pub fn save(path: &Path, kp: &Keypair) -> Result<()> {
    let bytes = kp.to_bytes().to_vec();
    let json = serde_json::to_string(&bytes)?;
    std::fs::write(path, json).with_context(|| format!("write keypair file {}", path.display()))
}

/// Generate and persist a brand-new keypair at `<keys_dir>/<name>.json`,
/// failing if one already exists (used for auditor-key rotation, where each
/// generation must be a distinct file that is never overwritten).
pub fn generate_new(name: &str) -> Result<Keypair> {
    let dir = keys_dir();
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{name}.json"));
    if path.exists() {
        anyhow::bail!("keypair file {} already exists", path.display());
    }
    let kp = Keypair::new();
    save(&path, &kp)?;
    Ok(kp)
}
