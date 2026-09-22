//! One-shot setup: generate/load every keypair, airdrop the payer, create the
//! confidential mint if needed, and configure both personas' token accounts.
//! Safe to re-run — every step is idempotent.

use rust_service::setup;
use solana_sdk::signature::Signer;

fn main() {
    match setup::load_or_bootstrap() {
        Ok(env) => {
            println!("devnet environment ready.");
            println!("  payer:            {}", env.payer.pubkey());
            println!("  mint:             {}", env.mint.pubkey());
            println!("  mint authority:   {}", env.mint_authority.pubkey());
            println!("  sender:           {}", env.sender.pubkey());
            println!("  receiver:         {}", env.receiver.pubkey());
            println!(
                "  auditor (gen {}): {}",
                env.auditor_generation,
                env.auditor_authority.pubkey()
            );
            println!("  auditor ElGamal pubkey: {}", env.auditor_elgamal.pubkey());
        }
        Err(e) => {
            eprintln!("bootstrap failed: {e}");
            std::process::exit(1);
        }
    }
}
