//! Stage an oversized proof through an spl-record account so its verify
//! instruction can reference it by account + offset instead of carrying the
//! bytes inline. Needed whenever `create_account + verify_proof` for a given
//! proof type doesn't fit in a single legacy (1232-byte) transaction —
//! confirmed on devnet to be true for both the U128 range proof (confidential
//! transfer) and the U64 range proof (withdraw).

use crate::types::CtResult;
use solana_client::rpc_client::RpcClient;
use solana_sdk::{
    signature::{Keypair, Signature, Signer},
    transaction::Transaction,
};
use solana_system_interface::instruction as system_instruction;

/// Byte offset of the proof data inside an spl-record account
/// (`RecordData::WRITABLE_START_INDEX`: 1-byte version + 32-byte authority).
pub const RECORD_PROOF_OFFSET: u32 = 33;
const RECORD_FIRST_CHUNK: usize = 750;
const RECORD_WRITE_CHUNK: usize = 900;

/// Create an spl-record account owned by `payer` and write `proof_bytes`
/// into it in tx-sized chunks. `trailing_ixs` (with `trailing_signers`) ride
/// along on the final write transaction so a caller's create-context +
/// verify-from-account don't cost an extra transaction.
pub fn stage_proof_record(
    client: &RpcClient,
    payer: &dyn Signer,
    record_account: &Keypair,
    proof_bytes: &[u8],
    trailing_ixs: &[solana_sdk::instruction::Instruction],
    trailing_signers: &[&dyn Signer],
) -> CtResult<Vec<Signature>> {
    let space = proof_bytes.len() + RECORD_PROOF_OFFSET as usize;
    let rent = client.get_minimum_balance_for_rent_exemption(space)?;

    if proof_bytes.is_empty() {
        return Err("proof had no bytes to stage".into());
    }

    let first_len = proof_bytes.len().min(RECORD_FIRST_CHUNK);
    let (first, rest) = proof_bytes.split_at(first_len);

    let mut sigs = Vec::new();
    let mut offset = 0usize;

    sigs.push(send_tx(
        client,
        &[
            system_instruction::create_account(
                &payer.pubkey(),
                &record_account.pubkey(),
                rent,
                space as u64,
                &spl_record::id(),
            ),
            spl_record::instruction::initialize(&record_account.pubkey(), &payer.pubkey()),
            spl_record::instruction::write(&record_account.pubkey(), &payer.pubkey(), 0, first),
        ],
        &[payer, record_account],
        &payer.pubkey(),
    )?);
    offset += first.len();

    let mut chunks = rest.chunks(RECORD_WRITE_CHUNK).peekable();
    let mut trailing_attached = false;
    while let Some(chunk) = chunks.next() {
        let mut ixs = vec![spl_record::instruction::write(
            &record_account.pubkey(),
            &payer.pubkey(),
            offset as u64,
            chunk,
        )];
        let mut signers: Vec<&dyn Signer> = vec![payer];
        if chunks.peek().is_none() {
            ixs.extend_from_slice(trailing_ixs);
            signers.extend_from_slice(trailing_signers);
            trailing_attached = true;
        }
        sigs.push(send_tx(client, &ixs, &signers, &payer.pubkey())?);
        offset += chunk.len();
    }

    if !trailing_attached {
        let mut signers: Vec<&dyn Signer> = vec![payer];
        signers.extend_from_slice(trailing_signers);
        sigs.push(send_tx(client, trailing_ixs, &signers, &payer.pubkey())?);
    }

    Ok(sigs)
}

pub fn send_tx(
    client: &RpcClient,
    ixs: &[solana_sdk::instruction::Instruction],
    signers: &[&dyn Signer],
    payer: &solana_sdk::pubkey::Pubkey,
) -> CtResult<Signature> {
    let blockhash = client.get_latest_blockhash()?;
    let tx = Transaction::new_signed_with_payer(ixs, Some(payer), signers, blockhash);
    Ok(client.send_and_confirm_transaction(&tx)?)
}
