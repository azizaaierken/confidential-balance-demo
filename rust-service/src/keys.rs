//! Local keypair persistence and confidential-key derivation.
//!
//! Every signer this demo uses (payer, mint authority, the two personas, and
//! each auditor-key generation) is a plain Ed25519 keypair held in a JSON
//! file on this machine — never a browser wallet. Files are created on first
//! use and reused after that, so the same devnet mint/accounts survive server
//! restarts.
//!
//! The ElGamal and AES keys that actually encrypt confidential balances are
//! not stored anywhere: they are re-derived on every use from the owner's
//! Ed25519 signature over a public seed (the token account address for a
//! persona, the mint address for the auditor). This is the one place that
//! derivation happens, so every module agrees on the scheme.

use anyhow::{anyhow, Context, Result};
use solana_sdk::{
    pubkey::Pubkey,
    signature::{Keypair, Signer},
};
use solana_zk_sdk::encryption::{
    auth_encryption::AeKey, derivation::derive_confidential_keys, elgamal::ElGamalKeypair,
};
use std::path::{Path, PathBuf};

// ============================================================================
// Confidential key derivation
// ============================================================================

/// Environment variable that opts into the pre-HKDF derivation scheme.
pub const LEGACY_KDF_ENV: &str = "LEGACY_KDF";

/// Whether this process should derive confidential keys with solana-zk-sdk's
/// original SHA3-512 scheme instead of the current HKDF-SHA512 one.
///
/// The two schemes produce different ElGamal/AES keys from the same signer,
/// so a token account configured under one cannot be decrypted under the
/// other. The current scheme is the default; set `LEGACY_KDF=1` only to keep
/// using devnet accounts that were provisioned before the SDK's migration
/// (https://github.com/solana-program/zk-elgamal-proof/issues/35). A fresh
/// clone with a fresh `keys/` directory should never need it.
pub fn legacy_kdf_enabled() -> bool {
    std::env::var(LEGACY_KDF_ENV)
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

/// Derive the ElGamal keypair and AES key that encrypt `token_account`'s
/// confidential balances, from its owner's signature.
pub fn derive_account_keys(
    owner: &dyn Signer,
    token_account: &Pubkey,
) -> Result<(ElGamalKeypair, AeKey)> {
    derive_with(owner, &token_account.to_bytes(), legacy_kdf_enabled())
}

/// Derive an auditor generation's ElGamal keypair from that generation's
/// signer, seeded with the mint it audits. Only the ElGamal half is used: the
/// auditor never holds an AES-encrypted balance of its own.
pub fn derive_auditor_elgamal(authority: &dyn Signer, mint: &Pubkey) -> Result<ElGamalKeypair> {
    Ok(derive_with(authority, &mint.to_bytes(), legacy_kdf_enabled())?.0)
}

fn derive_with(signer: &dyn Signer, seed: &[u8], legacy: bool) -> Result<(ElGamalKeypair, AeKey)> {
    if legacy {
        // Deliberately the deprecated functions: this branch exists precisely
        // to reproduce the old scheme for accounts provisioned under it.
        #[allow(deprecated)]
        {
            let elgamal = ElGamalKeypair::new_from_signer_legacy(signer, seed)
                .map_err(|e| anyhow!("derive legacy ElGamal keypair: {e}"))?;
            let aes = AeKey::new_from_signer_legacy(signer, seed)
                .map_err(|e| anyhow!("derive legacy AES key: {e}"))?;
            return Ok((elgamal, aes));
        }
    }
    derive_confidential_keys(signer, seed).map_err(|e| anyhow!("derive confidential keys: {e}"))
}

// ============================================================================
// Keypair files
// ============================================================================

pub fn keys_dir() -> PathBuf {
    std::env::var("RUST_SERVICE_KEYS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("keys"))
}

fn key_path(name: &str) -> Result<PathBuf> {
    let dir = keys_dir();
    std::fs::create_dir_all(&dir).with_context(|| format!("create keys dir {}", dir.display()))?;
    Ok(dir.join(format!("{name}.json")))
}

/// Load a keypair from `<keys_dir>/<name>.json`, generating and persisting a
/// new one if the file doesn't exist yet.
pub fn load_or_generate(name: &str) -> Result<Keypair> {
    load_or_generate_at(&key_path(name)?)
}

pub fn load_or_generate_at(path: &Path) -> Result<Keypair> {
    if path.exists() {
        load(path)
    } else {
        let kp = Keypair::new();
        save_new(path, &kp)?;
        Ok(kp)
    }
}

/// Load an existing keypair file, failing if it is missing.
pub fn load(path: &Path) -> Result<Keypair> {
    let raw = std::fs::read_to_string(path)
        .with_context(|| format!("read keypair file {}", path.display()))?;
    let bytes: Vec<u8> = serde_json::from_str(&raw)
        .with_context(|| format!("parse keypair file {}", path.display()))?;
    Keypair::try_from(bytes.as_slice()).map_err(|e| anyhow!("keypair file {}: {e}", path.display()))
}

/// Whether `<keys_dir>/<name>.json` already exists. Used to refuse an
/// auditor-key rotation up front, before anything is submitted on-chain.
pub fn exists(name: &str) -> Result<bool> {
    Ok(key_path(name)?.exists())
}

/// Persist a keypair the caller already generated (and, for auditor
/// rotation, already used on-chain) as `<keys_dir>/<name>.json`. Fails
/// rather than overwrites if the file exists: a generation's key must never
/// be silently replaced, or ciphertexts encrypted to it become unreadable.
pub fn persist_new(name: &str, kp: &Keypair) -> Result<PathBuf> {
    let path = key_path(name)?;
    save_new(&path, kp)?;
    Ok(path)
}

fn save_new(path: &Path, kp: &Keypair) -> Result<()> {
    use std::io::Write;
    let json = serde_json::to_string(&kp.to_bytes().to_vec())?;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .with_context(|| format!("create keypair file {}", path.display()))?;
    file.write_all(json.as_bytes())
        .with_context(|| format!("write keypair file {}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derivation_is_deterministic_for_a_signer_and_seed() {
        let owner = Keypair::new();
        let seed = Pubkey::new_unique();
        let (eg1, ae1) = derive_account_keys(&owner, &seed).unwrap();
        let (eg2, ae2) = derive_account_keys(&owner, &seed).unwrap();
        assert_eq!(eg1.pubkey(), eg2.pubkey());
        assert_eq!(ae1.encrypt(7).to_bytes().len(), 36);
        // Same key, same plaintext, decrypts back under the second derivation.
        assert_eq!(ae2.decrypt(&ae1.encrypt(4_200)), Some(4_200));
    }

    #[test]
    fn different_seeds_give_different_keys() {
        let owner = Keypair::new();
        let (a, _) = derive_account_keys(&owner, &Pubkey::new_unique()).unwrap();
        let (b, _) = derive_account_keys(&owner, &Pubkey::new_unique()).unwrap();
        assert_ne!(a.pubkey(), b.pubkey());
    }

    #[test]
    fn legacy_and_current_schemes_are_not_interchangeable() {
        let owner = Keypair::new();
        let seed = Pubkey::new_unique().to_bytes();
        let (current, _) = derive_with(&owner, &seed, false).unwrap();
        let (legacy, _) = derive_with(&owner, &seed, true).unwrap();
        assert_ne!(current.pubkey(), legacy.pubkey());
    }

    #[test]
    fn auditor_key_is_the_elgamal_half_of_the_same_derivation() {
        let authority = Keypair::new();
        let mint = Pubkey::new_unique();
        let auditor = derive_auditor_elgamal(&authority, &mint).unwrap();
        let (elgamal, _) = derive_account_keys(&authority, &mint).unwrap();
        assert_eq!(auditor.pubkey(), elgamal.pubkey());
    }

    #[test]
    fn persist_new_refuses_to_overwrite() {
        let dir = std::env::temp_dir().join(format!("cb-keys-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("gen.json");
        let kp = Keypair::new();
        save_new(&path, &kp).unwrap();
        assert!(save_new(&path, &Keypair::new()).is_err());
        assert_eq!(load(&path).unwrap().pubkey(), kp.pubkey());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
