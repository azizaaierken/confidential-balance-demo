//! Display metadata for every auditor-key generation that has ever existed —
//! backs the frontend's key-rotation timeline. The numeric "which generation
//! is active right now" pointer lives separately in
//! `setup::active_auditor_generation` (a plain counter file used to pick
//! which keypair file to load for signing/decrypting); this registry is
//! purely descriptive (label, pubkey, created/retired timestamps) and must be
//! kept in step with that pointer whenever a rotation happens.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::RwLock;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditorGenerationRecord {
    pub id: String,
    pub generation: u32,
    pub label: String,
    pub elgamal_pubkey: String,
    pub created_at: i64,
    pub retired_at: Option<i64>,
    pub status: String, // "active" | "retired"
}

pub struct AuditorRegistry {
    path: PathBuf,
    entries: RwLock<Vec<AuditorGenerationRecord>>,
}

impl AuditorRegistry {
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

    fn persist(&self, entries: &[AuditorGenerationRecord]) -> Result<()> {
        std::fs::write(&self.path, serde_json::to_string_pretty(entries)?)?;
        Ok(())
    }

    pub fn all(&self) -> Vec<AuditorGenerationRecord> {
        self.entries.read().unwrap().clone()
    }

    /// Ensure generation `gen` has a record (used at startup, so generation 1
    /// always shows up in the timeline even before any rotation happens).
    pub fn ensure_generation(
        &self,
        generation: u32,
        elgamal_pubkey: String,
        now: i64,
    ) -> Result<()> {
        let mut entries = self.entries.write().unwrap();
        if entries.iter().any(|e| e.generation == generation) {
            return Ok(());
        }
        entries.push(AuditorGenerationRecord {
            id: format!("auditor-key-gen-{generation}"),
            generation,
            label: format!("Auditor Key — Generation {generation}"),
            elgamal_pubkey,
            created_at: now,
            retired_at: None,
            status: "active".to_string(),
        });
        self.persist(&entries)
    }

    /// Retire every currently-active generation and add the new one.
    pub fn rotate(
        &self,
        new_generation: u32,
        elgamal_pubkey: String,
        now: i64,
    ) -> Result<()> {
        let mut entries = self.entries.write().unwrap();
        for e in entries.iter_mut() {
            if e.status == "active" {
                e.status = "retired".to_string();
                e.retired_at = Some(now);
            }
        }
        entries.push(AuditorGenerationRecord {
            id: format!("auditor-key-gen-{new_generation}"),
            generation: new_generation,
            label: format!("Auditor Key — Generation {new_generation}"),
            elgamal_pubkey,
            created_at: now,
            retired_at: None,
            status: "active".to_string(),
        });
        self.persist(&entries)
    }

    pub fn generation_for_id(&self, id: &str) -> Option<u32> {
        self.entries
            .read()
            .unwrap()
            .iter()
            .find(|e| e.id == id)
            .map(|e| e.generation)
    }
}
