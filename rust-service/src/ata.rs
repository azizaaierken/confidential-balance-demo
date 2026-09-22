//! Associated-token-account address derivation, inlined instead of pulled
//! from the `spl-associated-token-account` crate: that crate's latest
//! release (8.0.0) still depends on `spl-token-2022-interface` 2.1.0, which
//! drags in a whole older lineage of `solana-address`/`solana-zk-sdk` behind
//! it — duplicating the versions the rest of this crate depends on directly
//! for confidential-transfer proof construction. The derivation itself is a
//! pure, deterministic PDA lookup with no on-chain interaction, so it's
//! simpler to keep it in sync with the ATA program directly here than to
//! carry that extra dependency subtree.

use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
};

const ASSOCIATED_TOKEN_PROGRAM_ID: Pubkey =
    solana_sdk::pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

pub fn get_associated_token_address_with_program_id(
    wallet_address: &Pubkey,
    token_mint_address: &Pubkey,
    token_program_id: &Pubkey,
) -> Pubkey {
    Pubkey::find_program_address(
        &[
            wallet_address.as_ref(),
            token_program_id.as_ref(),
            token_mint_address.as_ref(),
        ],
        &ASSOCIATED_TOKEN_PROGRAM_ID,
    )
    .0
}

/// `AssociatedTokenAccountInstruction::CreateIdempotent` (discriminator `1`) —
/// same account layout and instruction data the ATA program has always used.
pub fn create_associated_token_account_idempotent(
    funding_address: &Pubkey,
    wallet_address: &Pubkey,
    token_mint_address: &Pubkey,
    token_program_id: &Pubkey,
) -> Instruction {
    let associated_account_address = get_associated_token_address_with_program_id(
        wallet_address,
        token_mint_address,
        token_program_id,
    );
    Instruction {
        program_id: ASSOCIATED_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*funding_address, true),
            AccountMeta::new(associated_account_address, false),
            AccountMeta::new_readonly(*wallet_address, false),
            AccountMeta::new_readonly(*token_mint_address, false),
            AccountMeta::new_readonly(solana_system_interface::program::id(), false),
            AccountMeta::new_readonly(*token_program_id, false),
        ],
        data: vec![1],
    }
}
