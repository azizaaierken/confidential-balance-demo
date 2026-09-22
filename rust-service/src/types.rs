//! Common types for confidential transfer operations.

use solana_sdk::signature::Signature;
use std::error::Error;

pub type CtResult<T> = Result<T, Box<dyn Error + Send + Sync>>;
pub type SigResult = CtResult<Signature>;
pub type MultiSigResult = CtResult<Vec<Signature>>;

/// Progress events emitted during a multi-transaction confidential operation,
/// so the frontend's progress tracker (Preparing proof / Awaiting approval /
/// Submitted / Confirmed) can reflect real devnet latency instead of a fixed
/// timeout.
#[derive(Clone, Debug, serde::Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum TransferProgress {
    Phase { name: String, detail: String },
    Signature { label: String, sig: String },
    Done { sigs: Vec<String> },
    Error { message: String },
}

pub type ProgressSink<'a> = Option<&'a tokio::sync::broadcast::Sender<TransferProgress>>;

pub fn emit(sink: ProgressSink<'_>, ev: TransferProgress) {
    if let Some(tx) = sink {
        let _ = tx.send(ev);
    }
}

/// One real transaction plus a stable key describing what it did (e.g.
/// `"verify_equality_proof"`). The frontend looks up a translated label for
/// the key — never bakes English text into the record — same pattern as
/// `FailureStage`/`ActivityType`. This is what backs the technical-evidence
/// breakdown: for any multi-transaction operation, Solscan only reliably
/// decodes the Token-2022 instruction itself, not the separate ZK ElGamal
/// Proof program instructions (context-state create/verify/close) that make
/// up the rest — so this is captured here, since our own service is the only
/// thing that actually knows what each of those transactions was for.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabeledSignature {
    pub label: String,
    pub signature: String,
    /// 1-based index, only set for steps that repeat (e.g. multiple
    /// range-proof staging transactions) — lets the frontend render "part N"
    /// without baking a number into the translated label itself.
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

    pub fn with_part(label: &str, signature: &Signature, part: u32) -> Self {
        Self {
            label: label.to_string(),
            signature: signature.to_string(),
            part: Some(part),
        }
    }
}

/// Result of a confidential transfer: every transaction (labeled), plus the
/// auditor's ElGamal ciphertext of the transferred amount (lo/hi halves,
/// hex-encoded POD bytes) if the mint has an auditor configured. This
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

/// Result of a withdraw: the (one, V1-transaction) submitted signature,
/// labeled — kept as a `Vec` for parity with `TransferOutcome`/older
/// multi-transaction activity entries still present in the activity log.
#[derive(Clone, Debug)]
pub struct WithdrawOutcome {
    pub steps: Vec<LabeledSignature>,
}

impl WithdrawOutcome {
    pub fn withdraw_signature(&self) -> Option<&str> {
        self.steps
            .iter()
            .find(|s| s.label == "submit_withdraw" || s.label == "submit_withdraw_v1")
            .map(|s| s.signature.as_str())
    }
}
