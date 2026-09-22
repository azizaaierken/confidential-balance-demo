//! A small local, append-only activity log. Every operation the HTTP server
//! performs appends one entry here, carrying its real signature(s) — this is
//! what backs the frontend's Recent Activity / Audit Console feeds, since
//! there is no chain indexer in this demo to reconstruct that feed from raw
//! devnet state after the fact.
//!
//! For confidential transfers specifically, the auditor's ElGamal ciphertext
//! of the amount is captured here too, at the moment of transfer — Token-2022
//! does not persist that ciphertext in any account after confirmation, so it
//! must be captured now or never (see `transfer::transfer_confidential`).

use crate::types::LabeledSignature;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::RwLock;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityEntry {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String, // "mint" | "deposit" | "withdraw" | "confidential_transfer" | "apply_pending"
    pub from_account_id: String,
    pub to_account_id: String,
    pub status: String,  // "confirmed" | "failed"
    pub privacy: String, // "public" | "confidential"
    pub timestamp: i64,
    pub signature: String,
    pub signatures: Vec<String>,
    // Technical evidence: what each real transaction in this operation did.
    // Every current operation is a single transaction, with the ZK ElGamal
    // Proof program's verify instructions riding inline (Solscan shows those
    // as "Unknown: Unknown", confirmed by hand). Entries written by earlier
    // versions of this service may carry several transactions' worth of
    // context-state create/verify/close steps instead.
    #[serde(default)]
    pub steps: Vec<LabeledSignature>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub public_amount_ui: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auditor_key_generation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auditor_ciphertext_lo_hex: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auditor_ciphertext_hi_hex: Option<String>,
    // Persisted ground truth once an auditor actually runs `/auditor/disclose`
    // (see `set_disclosed_amount`) — but what a given `/state` response
    // actually carries here is redacted per-request in server.rs's
    // `read_state`: stripped back to `None` unless the caller is viewing as
    // the auditor. The Audit Console reads this field, and only this
    // field, to mean "an auditor disclosed this" — it must never also carry
    // party-visibility (see `party_visible_amount_ui` below), or the console
    // would show an amount as "disclosed" that no auditor ever disclosed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disclosed_amount_ui: Option<f64>,
    // The real amount for a confidential_transfer, known to the service at
    // execution time (it's what was requested) — never serialized as-is (see
    // server.rs's redaction pass, which reads this to populate
    // `party_visible_amount_ui` below and always clears this field itself).
    // Its two parties always know their own transfer's amount in the real
    // protocol, independent of any auditor disclosure.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub party_amount_ui: Option<f64>,
    // Per-request redacted view of `party_amount_ui` above: set only when
    // the caller is viewing as the owner of one of this transfer's own two
    // parties, regardless of auditor status. Kept as a field
    // distinct from `disclosed_amount_ui` on purpose — the account-detail
    // page (a party looking at their own history) reads this one; the Audit
    // Console must never read it, since a party seeing their own transfer
    // is not the same thing as an auditor disclosing it.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub party_visible_amount_ui: Option<f64>,
}

pub struct ActivityLog {
    path: PathBuf,
    entries: RwLock<Vec<ActivityEntry>>,
}

impl ActivityLog {
    pub fn load_or_create(path: PathBuf) -> Result<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)
                .with_context(|| format!("create dir {}", dir.display()))?;
        }
        let entries = if path.exists() {
            let raw = std::fs::read_to_string(&path)
                .with_context(|| format!("read activity log {}", path.display()))?;
            serde_json::from_str(&raw).unwrap_or_default()
        } else {
            Vec::new()
        };
        Ok(Self {
            path,
            entries: RwLock::new(entries),
        })
    }

    pub fn append(&self, entry: ActivityEntry) -> Result<()> {
        let mut entries = self.entries.write().unwrap();
        entries.insert(0, entry);
        let json = serde_json::to_string_pretty(&*entries)?;
        std::fs::write(&self.path, json)?;
        Ok(())
    }

    pub fn all(&self) -> Vec<ActivityEntry> {
        self.entries.read().unwrap().clone()
    }

    pub fn find(&self, id: &str) -> Option<ActivityEntry> {
        self.entries
            .read()
            .unwrap()
            .iter()
            .find(|e| e.id == id)
            .cloned()
    }

    /// Update one entry's `disclosed_amount_ui` in place (recording a
    /// successful audit disclosure) and persist.
    pub fn set_disclosed_amount(&self, id: &str, amount_ui: f64) -> Result<()> {
        let mut entries = self.entries.write().unwrap();
        if let Some(e) = entries.iter_mut().find(|e| e.id == id) {
            e.disclosed_amount_ui = Some(amount_ui);
        }
        let json = serde_json::to_string_pretty(&*entries)?;
        std::fs::write(&self.path, json)?;
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditDisclosure {
    pub id: String,
    pub activity_id: String,
    pub requested_by: String,
    pub reason: String,
    pub timestamp: i64,
    pub key_generation_id: String,
    pub decrypted_amount_ui: f64,
    pub outcome: String, // "success" | "wrong_key_generation"
}

pub struct DisclosureLog {
    path: PathBuf,
    entries: RwLock<Vec<AuditDisclosure>>,
}

impl DisclosureLog {
    pub fn load_or_create(path: PathBuf) -> Result<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let entries = if path.exists() {
            let raw = std::fs::read_to_string(&path)?;
            serde_json::from_str(&raw).unwrap_or_default()
        } else {
            Vec::new()
        };
        Ok(Self {
            path,
            entries: RwLock::new(entries),
        })
    }

    pub fn append(&self, entry: AuditDisclosure) -> Result<()> {
        let mut entries = self.entries.write().unwrap();
        entries.insert(0, entry);
        let json = serde_json::to_string_pretty(&*entries)?;
        std::fs::write(&self.path, json)?;
        Ok(())
    }

    pub fn all(&self) -> Vec<AuditDisclosure> {
        self.entries.read().unwrap().clone()
    }
}
