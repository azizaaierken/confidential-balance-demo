//! HTTP API for the Confidential Balance demo frontend. Wraps every
//! operation module in `rust_service` behind plain REST endpoints so the
//! Next.js app can drive real devnet Token-2022 confidential transfers
//! without holding any signing key itself — every key lives here, locally.

use anyhow::{anyhow, Result};
use axum::{
    extract::State as AxumState,
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use rust_service::{
    activity::{ActivityEntry, ActivityLog, AuditDisclosure, DisclosureLog},
    apply_pending, auditor, auditor_registry::AuditorRegistry, deposit, mint, setup, transfer,
    types::LabeledSignature, view, withdraw,
};
use serde::{Deserialize, Serialize};
use solana_client::rpc_client::RpcClient;
use solana_sdk::signature::{Keypair, Signer};
use std::sync::Arc;
use tower_http::cors::CorsLayer;

const DECIMALS: u8 = setup::MINT_DECIMALS;

fn ui_to_base(ui: f64) -> u64 {
    (ui * 10f64.powi(DECIMALS as i32)).round() as u64
}
fn base_to_ui(base: u64) -> f64 {
    base as f64 / 10f64.powi(DECIMALS as i32)
}
fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

// ============================================================================
// State
// ============================================================================

#[derive(Clone)]
struct AppState {
    rpc: Arc<RpcClient>,
    payer: Arc<Keypair>,
    mint: Arc<Keypair>,
    mint_authority: Arc<Keypair>,
    sender: Arc<Keypair>,
    receiver: Arc<Keypair>,
    activity: Arc<ActivityLog>,
    disclosures: Arc<DisclosureLog>,
    registry: Arc<AuditorRegistry>,
}

impl AppState {
    fn signer_for(&self, account_id: &str) -> Result<&Keypair> {
        match account_id {
            "sender" => Ok(&self.sender),
            "receiver" => Ok(&self.receiver),
            other => Err(anyhow!("unknown accountId: {other}")),
        }
    }

    fn active_generation(&self) -> Result<u32> {
        setup::active_auditor_generation().map_err(|e| anyhow!("{e}"))
    }
}

// ============================================================================
// Errors
// ============================================================================

struct AppError(anyhow::Error);
impl<E: Into<anyhow::Error>> From<E> for AppError {
    fn from(e: E) -> Self {
        Self(e.into())
    }
}
impl IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        let body = serde_json::json!({ "ok": false, "error": format!("{:#}", self.0) });
        tracing::warn!("handler error: {:#}", self.0);
        (StatusCode::INTERNAL_SERVER_ERROR, Json(body)).into_response()
    }
}
type ApiResult<T> = std::result::Result<Json<T>, AppError>;

// ============================================================================
// Response / request shapes
// ============================================================================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MintView {
    address: String,
    name: String,
    symbol: String,
    decimals: u8,
    program_id: String,
    zk_proof_program_id: String,
    confidential_transfer_authority: String,
    extensions: Vec<String>,
    auto_approve_new_accounts: bool,
    cluster: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfidentialAmountView {
    ciphertext: String,
    decrypted: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BalanceView {
    account_id: String,
    address: String,
    token_account: String,
    public_balance: f64,
    confidential_available: ConfidentialAmountView,
    confidential_pending: ConfidentialAmountView,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StateResponse {
    ok: bool,
    mint: MintView,
    total_supply: f64,
    balances: std::collections::HashMap<String, BalanceView>,
    auditor_key_generations: Vec<rust_service::auditor_registry::AuditorGenerationRecord>,
    activity: Vec<ActivityEntry>,
    audit_disclosures: Vec<AuditDisclosure>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ActionResponse {
    ok: bool,
    signature: String,
    signatures: Vec<String>,
    state: StateResponse,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AmountBody {
    account_id: String,
    amount: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountBody {
    account_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransferBody {
    from_account_id: String,
    to_account_id: String,
    amount: f64,
    #[serde(default)]
    origin_agent_proposal_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscloseBody {
    activity_id: String,
    key_generation_id: String,
    requested_by: String,
    reason: String,
}

// ============================================================================
// Main
// ============================================================================

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let env = setup::load_or_bootstrap().await.map_err(|e| anyhow!("{e}"))?;
    tracing::info!("mint:     {}", env.mint.pubkey());
    tracing::info!("sender:   {}", env.sender.pubkey());
    tracing::info!("receiver: {}", env.receiver.pubkey());

    let data_dir = std::env::var("RUST_SERVICE_DATA_DIR").unwrap_or_else(|_| "data".to_string());
    let activity = Arc::new(ActivityLog::load_or_create(
        format!("{data_dir}/activity.json").into(),
    )?);
    let disclosures = Arc::new(DisclosureLog::load_or_create(
        format!("{data_dir}/disclosures.json").into(),
    )?);
    let registry = Arc::new(AuditorRegistry::load_or_create(
        format!("{data_dir}/auditor-generations.json").into(),
    )?);
    registry.ensure_generation(
        env.auditor_generation,
        hex::encode(env.auditor_elgamal.pubkey().to_string()),
        now_ms(),
    )?;

    let state = AppState {
        rpc: Arc::new(env.rpc),
        payer: Arc::new(env.payer),
        mint: Arc::new(env.mint),
        mint_authority: Arc::new(env.mint_authority),
        sender: Arc::new(env.sender),
        receiver: Arc::new(env.receiver),
        activity,
        disclosures,
        registry,
    };

    let port: u16 = std::env::var("PORT").ok().and_then(|s| s.parse().ok()).unwrap_or(8787);
    let app = Router::new()
        .route("/state", get(state_handler))
        .route("/mint", post(mint_handler))
        .route("/deposit", post(deposit_handler))
        .route("/apply-pending", post(apply_pending_handler))
        .route("/withdraw", post(withdraw_handler))
        .route("/transfer", post(transfer_handler))
        .route("/auditor/rotate", post(auditor_rotate_handler))
        .route("/auditor/disclose", post(auditor_disclose_handler))
        .with_state(state)
        .layer(CorsLayer::permissive());

    let addr: std::net::SocketAddr = format!("0.0.0.0:{port}").parse()?;
    tracing::info!("listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

// ============================================================================
// Handlers
// ============================================================================

async fn state_handler(AxumState(s): AxumState<AppState>) -> ApiResult<StateResponse> {
    Ok(Json(read_state(&s)?))
}

async fn mint_handler(
    AxumState(s): AxumState<AppState>,
    Json(body): Json<AmountBody>,
) -> ApiResult<ActionResponse> {
    let recipient = s.signer_for(&body.account_id)?;
    let amount_base = ui_to_base(body.amount);
    let sig = mint::mint_additional_supply(
        &s.rpc,
        s.payer.as_ref(),
        &s.mint.pubkey(),
        s.mint_authority.as_ref(),
        &recipient.pubkey(),
        amount_base,
    )
    .map_err(|e| anyhow!("mint failed: {e}"))?;

    s.activity.append(ActivityEntry {
        id: format!("act-{}", &sig.to_string()[..12]),
        kind: "mint".to_string(),
        from_account_id: "mint".to_string(),
        to_account_id: body.account_id.clone(),
        status: "confirmed".to_string(),
        privacy: "public".to_string(),
        timestamp: now_ms(),
        signature: sig.to_string(),
        signatures: vec![sig.to_string()],
        steps: vec![LabeledSignature::new("mint", &sig)],
        public_amount_ui: Some(body.amount),
        auditor_key_generation_id: None,
        auditor_ciphertext_lo_hex: None,
        auditor_ciphertext_hi_hex: None,
        disclosed_amount_ui: None,
        origin_agent_proposal_id: None,
    })?;

    Ok(Json(ActionResponse {
        ok: true,
        signature: sig.to_string(),
        signatures: vec![sig.to_string()],
        state: read_state(&s)?,
    }))
}

async fn deposit_handler(
    AxumState(s): AxumState<AppState>,
    Json(body): Json<AmountBody>,
) -> ApiResult<ActionResponse> {
    let response = run_blocking(s, move |s| async move {
        let authority = s.signer_for(&body.account_id)?;
        let amount_base = ui_to_base(body.amount);
        let sig = deposit::deposit_to_confidential(
            &s.rpc,
            s.payer.as_ref(),
            authority,
            &s.mint.pubkey(),
            amount_base,
            DECIMALS,
        )
        .await
        .map_err(|e| anyhow!("deposit failed: {e}"))?;

        s.activity.append(ActivityEntry {
            id: format!("act-{}", &sig.to_string()[..12]),
            kind: "deposit".to_string(),
            from_account_id: body.account_id.clone(),
            to_account_id: body.account_id.clone(),
            status: "confirmed".to_string(),
            privacy: "public".to_string(),
            timestamp: now_ms(),
            signature: sig.to_string(),
            signatures: vec![sig.to_string()],
            steps: vec![LabeledSignature::new("deposit", &sig)],
            public_amount_ui: Some(body.amount),
            auditor_key_generation_id: None,
            auditor_ciphertext_lo_hex: None,
            auditor_ciphertext_hi_hex: None,
            disclosed_amount_ui: None,
            origin_agent_proposal_id: None,
        })?;

        Ok(ActionResponse {
            ok: true,
            signature: sig.to_string(),
            signatures: vec![sig.to_string()],
            state: read_state(&s)?,
        })
    })
    .await?;
    Ok(Json(response))
}

async fn apply_pending_handler(
    AxumState(s): AxumState<AppState>,
    Json(body): Json<AccountBody>,
) -> ApiResult<ActionResponse> {
    let response = run_blocking(s, move |s| async move {
        let authority = s.signer_for(&body.account_id)?;
        let outcome =
            apply_pending::apply_pending_balance(&s.rpc, s.payer.as_ref(), authority, &s.mint.pubkey())
                .await
                .map_err(|e| anyhow!("apply_pending failed: {e}"))?;

        s.activity.append(ActivityEntry {
            id: format!("act-{}", &outcome.signature.to_string()[..12]),
            kind: "apply_pending".to_string(),
            from_account_id: body.account_id.clone(),
            to_account_id: body.account_id.clone(),
            status: "confirmed".to_string(),
            privacy: "confidential".to_string(),
            timestamp: now_ms(),
            signature: outcome.signature.to_string(),
            signatures: vec![outcome.signature.to_string()],
            steps: vec![LabeledSignature::new("apply_pending", &outcome.signature)],
            public_amount_ui: None,
            auditor_key_generation_id: None,
            auditor_ciphertext_lo_hex: None,
            auditor_ciphertext_hi_hex: None,
            disclosed_amount_ui: None,
            origin_agent_proposal_id: None,
        })?;

        Ok(ActionResponse {
            ok: true,
            signature: outcome.signature.to_string(),
            signatures: vec![outcome.signature.to_string()],
            state: read_state(&s)?,
        })
    })
    .await?;
    Ok(Json(response))
}

async fn withdraw_handler(
    AxumState(s): AxumState<AppState>,
    Json(body): Json<AmountBody>,
) -> ApiResult<ActionResponse> {
    let response = run_blocking(s, move |s| async move {
        let authority = s.signer_for(&body.account_id)?;
        let amount_base = ui_to_base(body.amount);
        let outcome = withdraw::withdraw_from_confidential(
            &s.rpc,
            s.payer.as_ref(),
            authority,
            &s.mint.pubkey(),
            amount_base,
            DECIMALS,
        )
        .await
        .map_err(|e| anyhow!("withdraw failed: {e}"))?;

        let sig = outcome
            .withdraw_signature()
            .ok_or_else(|| anyhow!("withdraw produced no submit_withdraw step"))?
            .to_string();
        let all_sigs: Vec<String> = outcome.steps.iter().map(|s| s.signature.clone()).collect();

        s.activity.append(ActivityEntry {
            id: format!("act-{}", &sig[..12]),
            kind: "withdraw".to_string(),
            from_account_id: body.account_id.clone(),
            to_account_id: body.account_id.clone(),
            status: "confirmed".to_string(),
            privacy: "public".to_string(),
            timestamp: now_ms(),
            signature: sig.clone(),
            signatures: all_sigs.clone(),
            steps: outcome.steps.clone(),
            public_amount_ui: Some(body.amount),
            auditor_key_generation_id: None,
            auditor_ciphertext_lo_hex: None,
            auditor_ciphertext_hi_hex: None,
            disclosed_amount_ui: None,
            origin_agent_proposal_id: None,
        })?;

        Ok(ActionResponse {
            ok: true,
            signature: sig,
            signatures: all_sigs,
            state: read_state(&s)?,
        })
    })
    .await?;
    Ok(Json(response))
}

async fn transfer_handler(
    AxumState(s): AxumState<AppState>,
    Json(body): Json<TransferBody>,
) -> ApiResult<ActionResponse> {
    let response = run_blocking(s, move |s| async move {
        let sender = s.signer_for(&body.from_account_id)?;
        let recipient_pubkey = s.signer_for(&body.to_account_id)?.pubkey();
        let amount_base = ui_to_base(body.amount);

        let result = transfer::transfer_confidential_with_progress(
            &s.rpc,
            s.payer.as_ref(),
            sender,
            &s.mint.pubkey(),
            &recipient_pubkey,
            amount_base,
            None,
        )
        .await
        .map_err(|e| anyhow!("transfer failed: {e}"))?;

        let active_gen = s.active_generation()?;
        let gen_id = format!("auditor-key-gen-{active_gen}");
        let transfer_sig = result
            .final_signature()
            .ok_or_else(|| anyhow!("transfer produced no steps"))?
            .to_string();
        let all_sigs: Vec<String> = result.steps.iter().map(|s| s.signature.clone()).collect();

        s.activity.append(ActivityEntry {
            id: format!("act-{}", &transfer_sig[..12]),
            kind: "confidential_transfer".to_string(),
            from_account_id: body.from_account_id.clone(),
            to_account_id: body.to_account_id.clone(),
            status: "confirmed".to_string(),
            privacy: "confidential".to_string(),
            timestamp: now_ms(),
            signature: transfer_sig.clone(),
            signatures: all_sigs.clone(),
            steps: result.steps.clone(),
            public_amount_ui: None,
            auditor_key_generation_id: Some(gen_id),
            auditor_ciphertext_lo_hex: result.auditor_ciphertext_lo_hex.clone(),
            auditor_ciphertext_hi_hex: result.auditor_ciphertext_hi_hex.clone(),
            disclosed_amount_ui: None,
            origin_agent_proposal_id: body.origin_agent_proposal_id.clone(),
        })?;

        Ok(ActionResponse {
            ok: true,
            signature: transfer_sig,
            signatures: all_sigs,
            state: read_state(&s)?,
        })
    })
    .await?;
    Ok(Json(response))
}

async fn auditor_rotate_handler(AxumState(s): AxumState<AppState>) -> ApiResult<StateResponse> {
    let response = run_blocking(s, move |s| async move {
        let current_gen = s.active_generation()?;
        let new_gen = current_gen + 1;
        let new_authority = rust_service::keys::generate_new(&format!("auditor-gen-{new_gen}"))?;
        let new_elgamal = solana_zk_sdk::encryption::elgamal::ElGamalKeypair::new_from_signer(
            &new_authority,
            &s.mint.pubkey().to_bytes(),
        )
        .map_err(|e| anyhow!("derive new auditor ElGamal keypair: {e}"))?;

        mint::rotate_auditor_key(
            &s.rpc,
            s.payer.as_ref(),
            &s.mint.pubkey(),
            s.mint_authority.as_ref(),
            &new_elgamal,
        )
        .await
        .map_err(|e| anyhow!("rotate_auditor_key failed: {e}"))?;

        setup::set_active_auditor_generation(new_gen).map_err(|e| anyhow!("{e}"))?;
        s.registry
            .rotate(new_gen, hex::encode(new_elgamal.pubkey().to_string()), now_ms())?;

        read_state(&s)
    })
    .await?;
    Ok(Json(response))
}

/// Run a non-Send async closure on the blocking pool with its own
/// multi-threaded runtime. The confidential-transfer operation functions take
/// `&dyn Signer` and hold it across `.await` points; `dyn Signer` has no
/// `Send`/`Sync` supertrait bound, so the resulting future isn't `Send` and
/// can't run directly as an axum handler future (which axum requires to be
/// `Send`). Multi-threaded is required because the Solana RPC client calls
/// `block_in_place` internally, which panics on a current-thread runtime.
async fn run_blocking<F, Fut, T>(s: AppState, f: F) -> Result<T>
where
    F: FnOnce(AppState) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = Result<T>>,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(move || {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .map_err(|e| anyhow!("build runtime: {e}"))?;
        rt.block_on(f(s))
    })
    .await
    .map_err(|e| anyhow!("blocking join: {e}"))?
}

async fn auditor_disclose_handler(
    AxumState(s): AxumState<AppState>,
    Json(body): Json<DiscloseBody>,
) -> ApiResult<serde_json::Value> {
    let activity = s
        .activity
        .find(&body.activity_id)
        .ok_or_else(|| anyhow!("unknown activityId"))?;

    let (lo, hi) = match (
        activity.auditor_ciphertext_lo_hex.as_ref(),
        activity.auditor_ciphertext_hi_hex.as_ref(),
    ) {
        (Some(lo), Some(hi)) => (lo, hi),
        _ => {
            return Err(AppError(anyhow!(
                "activity {} has no captured auditor ciphertext",
                body.activity_id
            )))
        }
    };

    let requested_gen = s
        .registry
        .generation_for_id(&body.key_generation_id)
        .ok_or_else(|| anyhow!("unknown keyGenerationId"))?;
    let (_authority, elgamal) = setup::load_auditor_generation(requested_gen, &s.mint.pubkey())
        .map_err(|e| anyhow!("{e}"))?;

    let decrypted = auditor::decrypt_auditor_amount(lo, hi, &elgamal).map_err(|e| anyhow!("{e}"))?;

    let (outcome, amount_ui) = match decrypted {
        Some(amount) => ("success", base_to_ui(amount)),
        None => ("wrong_key_generation", 0.0),
    };

    if outcome == "success" {
        s.activity.set_disclosed_amount(&activity.id, amount_ui)?;
    }

    let record = AuditDisclosure {
        id: format!("disclosure-{}", now_ms()),
        activity_id: body.activity_id.clone(),
        requested_by: body.requested_by.clone(),
        reason: body.reason.clone(),
        timestamp: now_ms(),
        key_generation_id: body.key_generation_id.clone(),
        decrypted_amount_ui: amount_ui,
        outcome: outcome.to_string(),
    };
    s.disclosures.append(record.clone())?;

    Ok(Json(serde_json::json!({
        "ok": true,
        "disclosure": record,
        "state": read_state(&s)?,
    })))
}

// ============================================================================
// Shared state reader
// ============================================================================

fn read_state(s: &AppState) -> Result<StateResponse> {
    let sender_view =
        view::read_account_view(&s.rpc, &s.mint.pubkey(), &s.sender).map_err(|e| anyhow!("{e}"))?;
    let receiver_view =
        view::read_account_view(&s.rpc, &s.mint.pubkey(), &s.receiver).map_err(|e| anyhow!("{e}"))?;
    let supply = mint::read_total_supply(&s.rpc, &s.mint.pubkey()).map_err(|e| anyhow!("{e}"))?;

    let sender_ata = spl_associated_token_account::get_associated_token_address_with_program_id(
        &s.sender.pubkey(),
        &s.mint.pubkey(),
        &spl_token_2022::id(),
    );
    let receiver_ata = spl_associated_token_account::get_associated_token_address_with_program_id(
        &s.receiver.pubkey(),
        &s.mint.pubkey(),
        &spl_token_2022::id(),
    );

    let mut balances = std::collections::HashMap::new();
    balances.insert(
        "sender".to_string(),
        to_balance_view("sender", &s.sender.pubkey().to_string(), &sender_ata.to_string(), &sender_view),
    );
    balances.insert(
        "receiver".to_string(),
        to_balance_view(
            "receiver",
            &s.receiver.pubkey().to_string(),
            &receiver_ata.to_string(),
            &receiver_view,
        ),
    );

    Ok(StateResponse {
        ok: true,
        mint: MintView {
            address: s.mint.pubkey().to_string(),
            name: "Token-X".to_string(),
            symbol: "TOKEN-X".to_string(),
            decimals: DECIMALS,
            program_id: spl_token_2022::id().to_string(),
            zk_proof_program_id: "ZkE1Gama1Proof11111111111111111111111111111".to_string(),
            confidential_transfer_authority: s.mint_authority.pubkey().to_string(),
            extensions: vec!["ConfidentialTransferMint".to_string()],
            auto_approve_new_accounts: true,
            cluster: "devnet".to_string(),
        },
        total_supply: base_to_ui(supply),
        balances,
        auditor_key_generations: s.registry.all(),
        activity: s.activity.all(),
        audit_disclosures: s.disclosures.all(),
    })
}

fn to_balance_view(account_id: &str, address: &str, token_account: &str, v: &view::AccountView) -> BalanceView {
    BalanceView {
        account_id: account_id.to_string(),
        address: address.to_string(),
        token_account: token_account.to_string(),
        public_balance: base_to_ui(v.public),
        confidential_available: ConfidentialAmountView {
            ciphertext: v.available_ciphertext_fingerprint.clone(),
            decrypted: base_to_ui(v.available),
        },
        confidential_pending: ConfidentialAmountView {
            ciphertext: v.pending_ciphertext_fingerprint.clone(),
            decrypted: base_to_ui(v.pending),
        },
    }
}
