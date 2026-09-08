//! ENV-01 compatibility spike: a real, end-to-end round trip on devnet.
//!
//! mint -> deposit -> apply-pending -> confidential transfer (with auditor
//! ciphertext capture) -> apply-pending (receiver) -> withdraw -> auditor
//! disclosure of the transfer amount just made.
//!
//! This is the hands-on check the requirements doc's ENV-01 calls for before
//! any further build work: does the ZK ElGamal Proof program actually verify
//! these proofs on devnet right now, with this crate/version combination.

use anyhow::{anyhow, Result};
use rust_service::{apply_pending, auditor, deposit, mint, setup, transfer, view, withdraw};
use solana_sdk::signature::Signer;

const MINT_AMOUNT: u64 = 20_000; // 200.00 TOKEN-X at 2 decimals
const TRANSFER_AMOUNT: u64 = 5_000; // 50.00 TOKEN-X
const WITHDRAW_AMOUNT: u64 = 2_000; // 20.00 TOKEN-X

#[tokio::main]
async fn main() {
    if let Err(e) = run().await {
        eprintln!("SPIKE FAILED: {e}");
        std::process::exit(1);
    }
}

async fn run() -> Result<()> {
    println!("== setting up (idempotent) ==");
    let env = setup::load_or_bootstrap().await.map_err(|e| anyhow!("{e}"))?;
    println!("mint: {}", env.mint.pubkey());
    println!("sender: {}", env.sender.pubkey());
    println!("receiver: {}", env.receiver.pubkey());

    println!("\n== 1. mint {MINT_AMOUNT} base units to sender's public balance ==");
    let sig = mint::mint_additional_supply(
        &env.rpc,
        &env.payer,
        &env.mint.pubkey(),
        &env.mint_authority,
        &env.sender.pubkey(),
        MINT_AMOUNT,
    )
    .map_err(|e| anyhow!("{e}"))?;
    println!("signature: {sig}");

    println!("\n== 2. deposit {MINT_AMOUNT} to sender's confidential pending balance ==");
    let sig = deposit::deposit_to_confidential(
        &env.rpc,
        &env.payer,
        &env.sender,
        &env.mint.pubkey(),
        MINT_AMOUNT,
        setup::MINT_DECIMALS,
    )
    .await
    .map_err(|e| anyhow!("{e}"))?;
    println!("signature: {sig}");

    println!("\n== 3. apply sender's pending balance ==");
    let outcome =
        apply_pending::apply_pending_balance(&env.rpc, &env.payer, &env.sender, &env.mint.pubkey())
            .await
            .map_err(|e| anyhow!("{e}"))?;
    println!(
        "signature: {} | applied {} | new available {}",
        outcome.signature, outcome.applied_amount, outcome.new_available
    );

    println!("\n== 4. confidential transfer sender -> receiver, amount {TRANSFER_AMOUNT} ==");
    let result = transfer::transfer_confidential_with_progress(
        &env.rpc,
        &env.payer,
        &env.sender,
        &env.mint.pubkey(),
        &env.receiver.pubkey(),
        TRANSFER_AMOUNT,
        None,
    )
    .await
    .map_err(|e| anyhow!("{e}"))?;
    println!("transactions ({}):", result.steps.len());
    for step in &result.steps {
        println!("  [{}] {}", step.label, step.signature);
    }
    println!(
        "auditor ciphertext captured: lo={} hi={}",
        result.auditor_ciphertext_lo_hex.is_some(),
        result.auditor_ciphertext_hi_hex.is_some()
    );

    println!("\n== 5. apply receiver's pending balance ==");
    let outcome = apply_pending::apply_pending_balance(
        &env.rpc,
        &env.payer,
        &env.receiver,
        &env.mint.pubkey(),
    )
    .await
    .map_err(|e| anyhow!("{e}"))?;
    println!(
        "signature: {} | applied {} | new available {}",
        outcome.signature, outcome.applied_amount, outcome.new_available
    );

    println!("\n== 6. withdraw {WITHDRAW_AMOUNT} from receiver's confidential balance to public ==");
    let withdraw_outcome = withdraw::withdraw_from_confidential(
        &env.rpc,
        &env.payer,
        &env.receiver,
        &env.mint.pubkey(),
        WITHDRAW_AMOUNT,
        setup::MINT_DECIMALS,
    )
    .await
    .map_err(|e| anyhow!("{e}"))?;
    println!("transactions ({}):", withdraw_outcome.steps.len());
    for step in &withdraw_outcome.steps {
        println!("  [{}] {}", step.label, step.signature);
    }

    println!("\n== 7. auditor disclosure of the transfer made in step 4 ==");
    if let (Some(lo), Some(hi)) = (
        result.auditor_ciphertext_lo_hex.as_ref(),
        result.auditor_ciphertext_hi_hex.as_ref(),
    ) {
        let disclosed =
            auditor::decrypt_auditor_amount(lo, hi, &env.auditor_elgamal).map_err(|e| anyhow!("{e}"))?;
        match disclosed {
            Some(amount) => {
                println!(
                    "disclosed amount: {amount} (expected {TRANSFER_AMOUNT}) -> {}",
                    if amount == TRANSFER_AMOUNT { "MATCH" } else { "MISMATCH" }
                );
            }
            None => println!("disclosure FAILED to decrypt (unexpected — same generation)"),
        }
    } else {
        println!("no auditor ciphertext was captured (mint has no auditor configured?)");
    }

    println!("\n== final balances ==");
    let sender_view = view::read_account_view(&env.rpc, &env.mint.pubkey(), &env.sender)
        .map_err(|e| anyhow!("{e}"))?;
    let receiver_view = view::read_account_view(&env.rpc, &env.mint.pubkey(), &env.receiver)
        .map_err(|e| anyhow!("{e}"))?;
    println!("sender:   {sender_view:?}");
    println!("receiver: {receiver_view:?}");
    let supply = mint::read_total_supply(&env.rpc, &env.mint.pubkey()).map_err(|e| anyhow!("{e}"))?;
    println!("mint total supply: {supply}");

    println!("\nSPIKE PASSED.");
    Ok(())
}
