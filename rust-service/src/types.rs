//! Common types for confidential transfer operations.

use solana_sdk::signature::Signature;
use std::error::Error;

pub type CtResult<T> = Result<T, Box<dyn Error + Send + Sync>>;
pub type SigResult = CtResult<Signature>;

/// One real transaction plus a stable key describing what it did (e.g.
/// `"submit_transfer_v1"`). The frontend looks up a translated label for the
/// key — never bakes English text into the record — same pattern as
/// `FailureStage`/`ActivityType`. This backs the technical-evidence
/// breakdown: Solscan reliably decodes the Token-2022 instruction itself but
/// shows the ZK ElGamal Proof program's verify instructions riding alongside
/// it as "Unknown", so our own service is the only thing that knows what each
/// one was for.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabeledSignature {
    pub label: String,
    pub signature: String,
    /// 1-based index, only set for steps that repeat. Current operations are
    /// single-transaction and never set it; activity logs written by earlier
    /// multi-transaction versions of this service may still carry it.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub part: Option<u32>,
}

impl LabeledSignature {
    pub fn new(label: &str, signature: &Signature) -> Self {
        Self {
            label: label.to_string(),
            signature: signature.to_string(),
            part: None,
        }
    }
}

/// Result of a confidential transfer: the submitted transaction (labeled),
/// plus the auditor's ElGamal ciphertext of the transferred amount (lo/hi
/// halves, hex-encoded POD bytes) if the mint has an auditor configured. This
/// ciphertext only ever exists in this transaction's instruction data — it is
/// not persisted in any on-chain account after confirmation — so it must be
/// captured here, at transfer time, for later per-transfer auditor disclosure.
#[derive(Clone, Debug)]
pub struct TransferOutcome {
    pub steps: Vec<LabeledSignature>,
    pub auditor_ciphertext_lo_hex: Option<String>,
    pub auditor_ciphertext_hi_hex: Option<String>,
}

impl TransferOutcome {
    pub fn final_signature(&self) -> Option<&str> {
        self.steps.last().map(|s| s.signature.as_str())
    }
}

/// What the cluster said when asked to simulate a transfer without submitting
/// it — the node's own verdict on the real transaction, not a local guess.
/// `fee_lamports` is `None` only when the node declined the fee lookup; the
/// simulation itself still stands.
#[derive(Clone, Debug)]
pub struct TransferSimulation {
    pub success: bool,
    pub error: Option<String>,
    pub logs: Vec<String>,
    pub units_consumed: Option<u64>,
    pub fee_lamports: Option<u64>,
}

/// Result of a withdraw: the one submitted V1 transaction, labeled. Kept as a
/// `Vec` so it serializes the same way as `TransferOutcome` and as the older
/// multi-transaction entries that may still be present in an activity log.
#[derive(Clone, Debug)]
pub struct WithdrawOutcome {
    pub steps: Vec<LabeledSignature>,
}

impl WithdrawOutcome {
    pub fn withdraw_signature(&self) -> Option<&str> {
        self.steps
            .iter()
            // `submit_withdraw` is the label older activity-log entries carry.
            .find(|s| s.label == "submit_withdraw_v1" || s.label == "submit_withdraw")
            .map(|s| s.signature.as_str())
    }
}
