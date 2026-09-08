//! Per-transfer auditor disclosure: decrypt a captured auditor ciphertext
//! (hex-encoded lo/hi halves, produced by `transfer::transfer_confidential_with_progress`)
//! using one auditor-key generation's ElGamal secret key.
//!
//! Decryption fails safely (returns `Ok(None)`) if the ciphertext was
//! encrypted to a different auditor generation's pubkey than the one whose
//! secret is supplied here — the discrete log search simply finds no match.
//! This is what gives CB-07's "wrong generation fails safely" requirement for
//! free, with no special-case check needed.

use crate::types::*;
use solana_zk_sdk::encryption::elgamal::{ElGamalCiphertext, ElGamalKeypair};
use solana_zk_sdk_pod::encryption::elgamal::PodElGamalCiphertext as PodElGamalCiphertextV6;
use spl_token_2022::solana_zk_sdk::encryption::pod::elgamal::PodElGamalCiphertext as PodElGamalCiphertextLegacy;

pub fn decrypt_auditor_amount(
    lo_hex: &str,
    hi_hex: &str,
    auditor_elgamal: &ElGamalKeypair,
) -> CtResult<Option<u64>> {
    let lo_bytes = hex::decode(lo_hex).map_err(|e| format!("decode lo hex: {e}"))?;
    let hi_bytes = hex::decode(hi_hex).map_err(|e| format!("decode hi hex: {e}"))?;
    let lo_arr: [u8; 64] = lo_bytes
        .as_slice()
        .try_into()
        .map_err(|_| "auditor lo ciphertext: expected 64 bytes")?;
    let hi_arr: [u8; 64] = hi_bytes
        .as_slice()
        .try_into()
        .map_err(|_| "auditor hi ciphertext: expected 64 bytes")?;

    let lo_legacy = PodElGamalCiphertextLegacy::from(lo_arr);
    let hi_legacy = PodElGamalCiphertextLegacy::from(hi_arr);

    let lo_v6 = PodElGamalCiphertextV6(bytemuck::bytes_of(&lo_legacy).try_into().unwrap());
    let hi_v6 = PodElGamalCiphertextV6(bytemuck::bytes_of(&hi_legacy).try_into().unwrap());

    let lo_ct: Result<ElGamalCiphertext, _> = lo_v6.try_into();
    let hi_ct: Result<ElGamalCiphertext, _> = hi_v6.try_into();
    let (lo_ct, hi_ct) = match (lo_ct, hi_ct) {
        (Ok(l), Ok(h)) => (l, h),
        _ => return Ok(None),
    };

    let lo_amount = lo_ct.decrypt_u32(auditor_elgamal.secret());
    let hi_amount = hi_ct.decrypt_u32(auditor_elgamal.secret());
    match (lo_amount, hi_amount) {
        (Some(lo), Some(hi)) => Ok(Some((lo as u64) + ((hi as u64) << 16))),
        _ => Ok(None),
    }
}
