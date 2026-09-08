//! A small local, append-only activity log. Every operation the HTTP server
//! performs appends one entry here, carrying its real signature(s) — this is
//! what backs the frontend's Recent Activity / Audit Console feeds, since
//! there is no chain indexer in this demo to reconstruct that feed from raw
//! devnet state after the fact.
//!
//! For confidential transfers specifically, the auditor's ElGamal ciphertext
//! of the amount is captured here too, at the moment of transfer — Token-2022
//! does not persist that ciphertext in any account after confirmation, so it
//! must be captured now or never (see `transfer::transfer_confidential_with_progress`).

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
    pub status: String, // "confirmed" | "failed"
    pub privacy: String, // "public" | "confidential"
    pub timestamp: i64,
    pub signature: String,
    pub signatures: Vec<String>,
    // Technical evidence: what each real transaction in this operation
    // actually did. Solscan only reliably decodes the Token-2022 instruction
    // itself — the separate ZK ElGamal Proof program instructions (context
    // state create/verify/close) that make up the rest of a confidential
    // transfer or withdraw show up there as "Unknown: Unknown" (confirmed by
    // hand against a real transaction). This is our own record of what each
    // one was for, since only this service actually knows.
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disclosed_amount_ui: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub origin_agent_proposal_id: Option<String>,
}

pub struct ActivityLog {
    path: PathBuf,
    entries: RwLock<Vec<ActivityEntry>>,
}

impl ActivityLog {
    pub fn load_or_create(path: PathBuf) -> Result<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).with_context(|| format!("create dir {}", dir.display()))?;
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
        self.entries.read().unwrap().iter().find(|e| e.id == id).cloned()
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
