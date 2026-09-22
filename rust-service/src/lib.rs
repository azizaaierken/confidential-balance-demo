//! Devnet backend for the Confidential Balance demo: Token-2022 confidential
//! transfer operations (configure, deposit, apply-pending, transfer,
//! withdraw), auditor-key management and disclosure, plus the local keypair,
//! activity-log and auth registries the HTTP server in `bin/server.rs` sits
//! on top of.
//!
//! Every operation module is synchronous: the Solana RPC client used here is
//! the blocking one, and the server runs each call on tokio's blocking pool.
//! Confidential keys are derived in exactly one place (`keys`), using the
//! SDK's current HKDF scheme by default — see `keys::legacy_kdf_enabled` for
//! the opt-in that keeps pre-migration devnet accounts readable.

pub mod activity;
pub mod apply_pending;
pub mod ata;
pub mod auditor;
pub mod auditor_registry;
pub mod auth;
pub mod configure;
pub mod deposit;
pub mod keys;
pub mod mint;
pub mod setup;
pub mod transfer;
pub mod types;
pub mod view;
pub mod withdraw;
