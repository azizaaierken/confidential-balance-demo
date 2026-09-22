//! Decrypt and read an account's public/pending/available balances. The
//! service holds every persona's keypair locally, so it can always decrypt —
//! view permissions (owner-only vs public-observer) are enforced entirely by
//! the frontend, exactly as they are today against simulated data.

use crate::ata::get_associated_token_address_with_program_id;
use crate::types::CtResult;
use solana_client::rpc_client::RpcClient;
use solana_sdk::signature::{Keypair, Signer};
use solana_zk_sdk::encryption::{
    auth_encryption::AeCiphertext, auth_encryption::AeKey, elgamal::ElGamalCiphertext,
    elgamal::ElGamalKeypair,
};
use solana_zk_sdk_pod::encryption::elgamal::PodElGamalCiphertext as PodElGamalCiphertextV6;
use spl_token_2022::{
    extension::{
        confidential_transfer::ConfidentialTransferAccount, BaseStateWithExtensions,
        StateWithExtensions,
    },
    state::Account as TokenAccount,
};

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

    let acc = StateWithExtensions::<TokenAccount>::unpack(&data.data)
        .map_err(|e| format!("unpack token account: {e}"))?;
    let public = acc.base.amount;

    let ct_ext = acc.get_extension::<ConfidentialTransferAccount>().ok();
    let (pending, available, available_fp, pending_fp) = match ct_ext {
        Some(ext) => {
            let elgamal = ElGamalKeypair::new_from_signer_legacy(owner, &token_account.to_bytes())
                .map_err(|e| format!("derive ElGamal keypair: {e}"))?;
            let aes = AeKey::new_from_signer_legacy(owner, &token_account.to_bytes())
                .map_err(|e| format!("derive AES key: {e}"))?;

            let pending_lo_v6 = PodElGamalCiphertextV6(
                bytemuck::bytes_of(&ext.pending_balance_lo)
                    .try_into()
                    .map_err(|_| "pending_balance_lo size")?,
            );
            let pending_hi_v6 = PodElGamalCiphertextV6(
                bytemuck::bytes_of(&ext.pending_balance_hi)
                    .try_into()
                    .map_err(|_| "pending_balance_hi size")?,
            );
            let pending_lo: ElGamalCiphertext = pending_lo_v6
                .try_into()
                .map_err(|e| format!("decode pending_lo: {e:?}"))?;
            let pending_hi: ElGamalCiphertext = pending_hi_v6
                .try_into()
                .map_err(|e| format!("decode pending_hi: {e:?}"))?;
            let pending_lo_v = pending_lo.decrypt_u32(elgamal.secret()).unwrap_or(0) as u64;
            let pending_hi_v = pending_hi.decrypt_u32(elgamal.secret()).unwrap_or(0) as u64;
            let pending_total = pending_lo_v + (pending_hi_v << 16);

            let avail_aes_bytes: [u8; 36] = bytemuck::bytes_of(&ext.decryptable_available_balance)
                .try_into()
                .map_err(|_| "decryptable_available_balance size")?;
            let avail_aes =
                AeCiphertext::from_bytes(&avail_aes_bytes).ok_or("decode AeCiphertext")?;
            let available = aes.decrypt(&avail_aes).unwrap_or(0);

            let available_fp = fingerprint(bytemuck::bytes_of(&ext.available_balance));
            let pending_fp = fingerprint(bytemuck::bytes_of(&ext.pending_balance_lo));

            (pending_total, available, available_fp, pending_fp)
        }
        None => (0, 0, String::new(), String::new()),
    };

    Ok(AccountView {
        public,
        pending,
        available,
        available_ciphertext_fingerprint: available_fp,
        pending_ciphertext_fingerprint: pending_fp,
    })
}
