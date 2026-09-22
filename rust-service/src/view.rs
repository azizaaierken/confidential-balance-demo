//! Decrypt and read an account's public/pending/available balances.
//!
//! The service holds every persona's keypair, so it can always decrypt both
//! confidential balances. Who gets to *see* the plaintext is decided per
//! request in `server.rs`'s `read_state`, from the caller's auth tokens —
//! this module just reads and decrypts.
//!
//! Decryption failure is an error, never a zero: a wrong key-derivation
//! scheme or a corrupt keypair file must surface as such rather than render
//! as an empty balance.

use crate::ata::get_associated_token_address_with_program_id;
use crate::keys;
use crate::types::CtResult;
use solana_client::rpc_client::RpcClient;
use solana_sdk::signature::{Keypair, Signer};
use solana_zk_sdk::encryption::{
    auth_encryption::AeCiphertext,
    elgamal::{ElGamalCiphertext, ElGamalSecretKey},
};
use solana_zk_sdk_pod::encryption::elgamal::PodElGamalCiphertext;
use spl_token_2022::{
    extension::{
        confidential_transfer::ConfidentialTransferAccount, BaseStateWithExtensions,
        StateWithExtensions,
    },
    state::Account as TokenAccount,
};

/// Memo of pending-balance ciphertexts already decrypted. Recovering a
/// pending balance means a discrete-log search over an ElGamal ciphertext,
/// which costs hundreds of milliseconds in a debug build, and every `/state`
/// read needs two per account. The ciphertext only changes when the pending
/// balance does, so keying the plaintext by the ciphertext bytes makes every
/// repeat read (view switches, post-action refreshes) free. The keys are the
/// same per-account ElGamal keys throughout the process, so a hit is always
/// valid.
#[derive(Default)]
pub struct DecryptCache(std::sync::Mutex<std::collections::HashMap<[u8; 64], u64>>);

impl DecryptCache {
    fn decrypt_u32(
        &self,
        pod: &PodElGamalCiphertext,
        ct: &ElGamalCiphertext,
        secret: &ElGamalSecretKey,
    ) -> Option<u64> {
        let key = pod.0;
        if let Some(v) = self.0.lock().unwrap().get(&key) {
            return Some(*v);
        }
        let v = ct.decrypt_u32(secret)?;
        self.0.lock().unwrap().insert(key, v);
        Some(v)
    }
}

#[derive(Debug, Clone, Default)]
pub struct AccountView {
    pub public: u64,
    pub pending: u64,
    pub available: u64,
    /// Short hex fingerprint of the real on-chain ciphertext bytes — for
    /// display only (e.g. "0x3f2a91e0…8b71c4"), never the full amount.
    pub available_ciphertext_fingerprint: String,
    pub pending_ciphertext_fingerprint: String,
}

fn fingerprint(bytes: &[u8]) -> String {
    let hex = hex::encode(bytes);
    if hex.len() <= 16 {
        format!("0x{hex}")
    } else {
        format!("0x{}…{}", &hex[..8], &hex[hex.len() - 6..])
    }
}

/// The hint appended to every decryption failure: by far the most likely
/// cause in this demo is a key-derivation mismatch, not a corrupt account.
fn kdf_hint() -> String {
    format!(
        "the key derived from the owner's signature does not decrypt this account; \
         if the account was configured before the SDK's HKDF migration, run with {}=1",
        keys::LEGACY_KDF_ENV
    )
}

/// Fetch and decrypt one account. `read_state` in the server batches the
/// fetches instead; this is the single-account convenience used by `spike`.
pub fn read_account_view(
    rpc: &RpcClient,
    mint: &solana_sdk::pubkey::Pubkey,
    owner: &Keypair,
) -> CtResult<AccountView> {
    let token_account =
        get_associated_token_address_with_program_id(&owner.pubkey(), mint, &spl_token_2022::id());
    let data = match rpc.get_account(&token_account) {
        Ok(a) => a,
        Err(e) if e.to_string().contains("AccountNotFound") => return Ok(AccountView::default()),
        Err(e) => return Err(format!("rpc get_account: {e}").into()),
    };
    decode_account_view(&data.data, owner, &token_account, &DecryptCache::default())
}

/// Decrypt an already-fetched token account.
pub fn decode_account_view(
    data: &[u8],
    owner: &Keypair,
    token_account: &solana_sdk::pubkey::Pubkey,
    cache: &DecryptCache,
) -> CtResult<AccountView> {
    let acc = StateWithExtensions::<TokenAccount>::unpack(data)
        .map_err(|e| format!("unpack token account: {e}"))?;
    let public = acc.base.amount;

    let Ok(ext) = acc.get_extension::<ConfidentialTransferAccount>() else {
        return Ok(AccountView {
            public,
            ..AccountView::default()
        });
    };

    let (elgamal, aes) = keys::derive_account_keys(owner, token_account)?;

    // Pending balance is only ever ElGamal-encrypted (deposits and incoming
    // transfers are added homomorphically by the program, which has no AES
    // key), so it has to be recovered by discrete-log search on the two
    // 16-bit halves. Available balance additionally carries an AES
    // ciphertext the owner wrote for exactly this purpose, so read that.
    let pending_lo: ElGamalCiphertext = ext
        .pending_balance_lo
        .try_into()
        .map_err(|e| format!("decode pending_balance_lo: {e:?}"))?;
    let pending_hi: ElGamalCiphertext = ext
        .pending_balance_hi
        .try_into()
        .map_err(|e| format!("decode pending_balance_hi: {e:?}"))?;
    let pending_lo_v = cache
        .decrypt_u32(&ext.pending_balance_lo, &pending_lo, elgamal.secret())
        .ok_or_else(|| {
            format!(
                "decrypt pending_balance_lo of {token_account}: {}",
                kdf_hint()
            )
        })?;
    let pending_hi_v = cache
        .decrypt_u32(&ext.pending_balance_hi, &pending_hi, elgamal.secret())
        .ok_or_else(|| {
            format!(
                "decrypt pending_balance_hi of {token_account}: {}",
                kdf_hint()
            )
        })?;
    let pending = pending_lo_v + (pending_hi_v << 16);

    let decryptable: AeCiphertext = ext
        .decryptable_available_balance
        .try_into()
        .map_err(|e| format!("decode decryptable_available_balance: {e:?}"))?;
    let available = aes.decrypt(&decryptable).ok_or_else(|| {
        format!(
            "decrypt decryptable_available_balance of {token_account}: {}",
            kdf_hint()
        )
    })?;

    Ok(AccountView {
        public,
        pending,
        available,
        available_ciphertext_fingerprint: fingerprint(bytemuck::bytes_of(&ext.available_balance)),
        pending_ciphertext_fingerprint: fingerprint(bytemuck::bytes_of(&ext.pending_balance_lo)),
    })
}
