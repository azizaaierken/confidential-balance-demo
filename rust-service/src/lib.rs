// This demo's devnet accounts were all provisioned under solana-zk-sdk's
// original SHA3-512 key-derivation scheme, before the HKDF-SHA512 migration
// introduced `derive_confidential_keys`. Switching derivation would produce
// different ElGamal/AES keys, unable to decrypt any already-configured
// account — so every persona's keys are deliberately still derived via the
// now-`_legacy`-suffixed functions, pinned on purpose, not left over.
#![allow(deprecated)]

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
