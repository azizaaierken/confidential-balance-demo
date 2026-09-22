//! HTTP API for the Confidential Balance demo frontend. Wraps every
//! operation module in `rust_service` behind plain REST endpoints so the
//! Next.js app can drive real devnet Token-2022 confidential transfers
//! without holding any signing key itself — every key lives here, locally.

// See rust_service::lib's crate-level `allow(deprecated)` — the auditor-key
// rotation handler below derives a new key with the same pinned legacy KDF.
#![allow(deprecated)]

use anyhow::{anyhow, Result};
use axum::{
    extract::State as AxumState,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use rust_service::{
    activity::{ActivityEntry, ActivityLog, AuditDisclosure, DisclosureLog},
    apply_pending, auditor,
    auditor_registry::AuditorRegistry,
    auth::{self, AuthRegistry, Role},
    deposit, mint, setup, transfer,
    types::LabeledSignature,
    view, withdraw,
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
    auth: Arc<AuthRegistry>,
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

struct AppError {
    status: StatusCode,
    err: anyhow::Error,
}
impl<E: Into<anyhow::Error>> From<E> for AppError {
    fn from(e: E) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            err: e.into(),
        }
    }
}
impl AppError {
    /// Build a 401 from an auth-check failure — use via `.map_err(AppError::unauthorized)`
    /// instead of `?` (which would default to 500 through the blanket `From` impl above).
    fn unauthorized(err: anyhow::Error) -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            err,
        }
    }

    /// The request itself is malformed — the caller asked for something that
    /// isn't a valid operation, rather than something that failed while running.
    fn bad_request(err: anyhow::Error) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            err,
        }
    }
}
impl IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        let body = serde_json::json!({ "ok": false, "error": format!("{:#}", self.err) });
        tracing::warn!("handler error: {:#}", self.err);
        (self.status, Json(body)).into_response()
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
    // `null` unless the caller's `X-Auth-Tokens` resolve to the owner of this
    // account — the server always decrypts internally, but only reveals the
    // plaintext to a request that's actually authorized to see it.
    decrypted: Option<f64>,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SimulateResponse {
    ok: bool,
    /// The node's verdict on the real transaction, proofs included.
    success: bool,
    error: Option<String>,
    logs: Vec<String>,
    units_consumed: Option<u64>,
    fee_lamports: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscloseBody {
    activity_id: String,
    key_generation_id: String,
    requested_by: String,
    reason: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoginBody {
    role: String,
    password: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LoginResponse {
    ok: bool,
    token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RotateBody {
    confirm_password: String,
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

    let env = setup::load_or_bootstrap()
        .await
        .map_err(|e| anyhow!("{e}"))?;
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
        auth: Arc::new(AuthRegistry::new()),
    };

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(8787);
    let app = Router::new()
        .route("/state", get(state_handler))
        .route("/auth/login", post(login_handler))
        .route("/mint", post(mint_handler))
        .route("/deposit", post(deposit_handler))
        .route("/apply-pending", post(apply_pending_handler))
        .route("/withdraw", post(withdraw_handler))
        .route("/transfer", post(transfer_handler))
        .route("/transfer/simulate", post(transfer_simulate_handler))
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

async fn state_handler(
    AxumState(s): AxumState<AppState>,
    headers: HeaderMap,
) -> ApiResult<StateResponse> {
    let roles = s.auth.roles_for(&headers, now_ms());
    Ok(Json(read_state(&s, &roles)?))
}

async fn login_handler(
    AxumState(s): AxumState<AppState>,
    Json(body): Json<LoginBody>,
) -> ApiResult<LoginResponse> {
    let role = Role::parse(&body.role)?;
    let token = s
        .auth
        .login(role, &body.password, now_ms())
        .map_err(AppError::unauthorized)?;
    Ok(Json(LoginResponse { ok: true, token }))
}

// Minting is a bank/mint-authority action (the server always holds that key)
// rather than something either persona needs to authorize with their own
// password — it never touches confidential state, so it's left open, unlike
// every action below that signs or discloses on a persona's behalf.
async fn mint_handler(
    AxumState(s): AxumState<AppState>,
    headers: HeaderMap,
    Json(body): Json<AmountBody>,
) -> ApiResult<ActionResponse> {
    let roles = s.auth.roles_for(&headers, now_ms());
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
        party_amount_ui: None,
        party_visible_amount_ui: None,
    })?;

    Ok(Json(ActionResponse {
        ok: true,
        signature: sig.to_string(),
        signatures: vec![sig.to_string()],
        state: read_state(&s, &roles)?,
    }))
}

async fn deposit_handler(
    AxumState(s): AxumState<AppState>,
    headers: HeaderMap,
    Json(body): Json<AmountBody>,
) -> ApiResult<ActionResponse> {
    let roles = s.auth.roles_for(&headers, now_ms());
    auth::require_owner(&roles, &body.account_id).map_err(AppError::unauthorized)?;
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
            party_amount_ui: None,
            party_visible_amount_ui: None,
        })?;

        Ok(ActionResponse {
            ok: true,
            signature: sig.to_string(),
            signatures: vec![sig.to_string()],
            state: read_state(&s, &roles)?,
        })
    })
    .await?;
    Ok(Json(response))
}

async fn apply_pending_handler(
    AxumState(s): AxumState<AppState>,
    headers: HeaderMap,
    Json(body): Json<AccountBody>,
) -> ApiResult<ActionResponse> {
    let roles = s.auth.roles_for(&headers, now_ms());
    auth::require_owner(&roles, &body.account_id).map_err(AppError::unauthorized)?;
    let response = run_blocking(s, move |s| async move {
        let authority = s.signer_for(&body.account_id)?;
        let outcome = apply_pending::apply_pending_balance(
            &s.rpc,
            s.payer.as_ref(),
            authority,
            &s.mint.pubkey(),
        )
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
            // The applied amount is still a confidential amount (moved from
            // pending into available balance, both encrypted) — never a
            // public one — so it's redacted the same way a transfer's own
            // amount is: visible only to this account's owner, via
            // `party_visible_amount_ui`, never unconditionally.
            party_amount_ui: Some(base_to_ui(outcome.applied_amount)),
            party_visible_amount_ui: None,
        })?;

        Ok(ActionResponse {
            ok: true,
            signature: outcome.signature.to_string(),
            signatures: vec![outcome.signature.to_string()],
            state: read_state(&s, &roles)?,
        })
    })
    .await?;
    Ok(Json(response))
}

async fn withdraw_handler(
    AxumState(s): AxumState<AppState>,
    headers: HeaderMap,
    Json(body): Json<AmountBody>,
) -> ApiResult<ActionResponse> {
    let roles = s.auth.roles_for(&headers, now_ms());
    auth::require_owner(&roles, &body.account_id).map_err(AppError::unauthorized)?;
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
            party_amount_ui: None,
            party_visible_amount_ui: None,
        })?;

        Ok(ActionResponse {
            ok: true,
            signature: sig,
            signatures: all_sigs,
            state: read_state(&s, &roles)?,
        })
    })
    .await?;
    Ok(Json(response))
}

async fn transfer_handler(
    AxumState(s): AxumState<AppState>,
    headers: HeaderMap,
    Json(body): Json<TransferBody>,
) -> ApiResult<ActionResponse> {
    let roles = s.auth.roles_for(&headers, now_ms());
    // An agent-initiated transfer is authorized by the bank's own
    // policy-check + human-approval flow (see the Agent Payments page and
    // its DecisionRecord), not by the customer's own password — the whole
    // point of that flow is that the bank-hosted agent acts without the
    // customer in the loop. A manual, owner-driven send still requires the
    // owner's own token.
    if body.origin_agent_proposal_id.is_none() {
        auth::require_owner(&roles, &body.from_account_id).map_err(AppError::unauthorized)?;
    }
    // Token-2022 will happily process a transfer whose source and destination
    // are the same account — it just moves the amount out of that account's
    // available balance and into its own pending balance, confirming
    // successfully while paying a fee to achieve nothing. There is no such
    // thing as paying yourself in this demo's model, so refuse it here rather
    // than let any caller (UI, agent, or curl) report it as a payment.
    if body.from_account_id == body.to_account_id {
        return Err(AppError::bad_request(anyhow!(
            "a transfer's sender and recipient must be different accounts"
        )));
    }
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
            party_amount_ui: Some(body.amount),
            party_visible_amount_ui: None,
        })?;

        Ok(ActionResponse {
            ok: true,
            signature: transfer_sig,
            signatures: all_sigs,
            state: read_state(&s, &roles)?,
        })
    })
    .await?;
    Ok(Json(response))
}

/// Pre-flight for a transfer the caller hasn't committed to yet: builds the
/// real transaction and has the cluster simulate it. Gated on the same owner
/// token a real send needs — the verdict (and the balance it implies) is the
/// sender's business, not a public endpoint.
async fn transfer_simulate_handler(
    AxumState(s): AxumState<AppState>,
    headers: HeaderMap,
    Json(body): Json<TransferBody>,
) -> ApiResult<SimulateResponse> {
    let roles = s.auth.roles_for(&headers, now_ms());
    auth::require_owner(&roles, &body.from_account_id).map_err(AppError::unauthorized)?;
    // Mirror the send path's guard, or the preflight would cheerfully report
    // that a self-payment simulates fine right before the send refuses it.
    if body.from_account_id == body.to_account_id {
        return Err(AppError::bad_request(anyhow!(
            "a transfer's sender and recipient must be different accounts"
        )));
    }
    let response = run_blocking(s, move |s| async move {
        let sender = s.signer_for(&body.from_account_id)?;
        let recipient_pubkey = s.signer_for(&body.to_account_id)?.pubkey();

        let sim = transfer::simulate_transfer(
            &s.rpc,
            s.payer.as_ref(),
            sender,
            &s.mint.pubkey(),
            &recipient_pubkey,
            ui_to_base(body.amount),
        )
        .await
        .map_err(|e| anyhow!("simulate failed: {e}"))?;

        Ok(SimulateResponse {
            ok: true,
            success: sim.success,
            error: sim.error,
            logs: sim.logs,
            units_consumed: sim.units_consumed,
            fee_lamports: sim.fee_lamports,
        })
    })
    .await?;
    Ok(Json(response))
}

async fn auditor_rotate_handler(
    AxumState(s): AxumState<AppState>,
    headers: HeaderMap,
    Json(body): Json<RotateBody>,
) -> ApiResult<StateResponse> {
    let roles = s.auth.roles_for(&headers, now_ms());
    auth::require_auditor(&roles).map_err(AppError::unauthorized)?;
    // Step-up: rotating the auditor key is consequential enough (every future
    // confidential transfer is disclosed with the new key from here on) that
    // holding a session token isn't treated as sufficient on its own — the
    // frontend's rotation ceremony re-collects the auditor password and this
    // re-checks it directly, independent of the bearer token.
    if !s.auth.check_password(Role::Auditor, &body.confirm_password) {
        return Err(AppError::unauthorized(anyhow!("wrong auditor password")));
    }
    let response = run_blocking(s, move |s| async move {
        let current_gen = s.active_generation()?;
        let new_gen = current_gen + 1;
        let new_authority = rust_service::keys::generate_new(&format!("auditor-gen-{new_gen}"))?;
        let new_elgamal =
            solana_zk_sdk::encryption::elgamal::ElGamalKeypair::new_from_signer_legacy(
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
        s.registry.rotate(
            new_gen,
            hex::encode(new_elgamal.pubkey().to_string()),
            now_ms(),
        )?;

        read_state(&s, &roles)
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
    headers: HeaderMap,
    Json(body): Json<DiscloseBody>,
) -> ApiResult<serde_json::Value> {
    let roles = s.auth.roles_for(&headers, now_ms());
    auth::require_auditor(&roles).map_err(AppError::unauthorized)?;

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
            return Err(anyhow!(
                "activity {} has no captured auditor ciphertext",
                body.activity_id
            )
            .into())
        }
    };

    let requested_gen = s
        .registry
        .generation_for_id(&body.key_generation_id)
        .ok_or_else(|| anyhow!("unknown keyGenerationId"))?;
    let (_authority, elgamal) = setup::load_auditor_generation(requested_gen, &s.mint.pubkey())
        .map_err(|e| anyhow!("{e}"))?;

    let decrypted =
        auditor::decrypt_auditor_amount(lo, hi, &elgamal).map_err(|e| anyhow!("{e}"))?;

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
        "state": read_state(&s, &roles)?,
    })))
}

// ============================================================================
// Shared state reader
// ============================================================================

/// Builds the full state internally (the service always holds every key, so
/// it always decrypts both balances) then reveals only what `roles` —
/// resolved from the caller's `X-Auth-Tokens` — actually proves it's
/// authorized to see. A caller with no valid tokens gets mint config, public
/// balances, and activity metadata only: no decrypted confidential amounts,
/// no disclosed amounts, no disclosure records.
fn read_state(s: &AppState, roles: &[Role]) -> Result<StateResponse> {
    let sender_view =
        view::read_account_view(&s.rpc, &s.mint.pubkey(), &s.sender).map_err(|e| anyhow!("{e}"))?;
    let receiver_view = view::read_account_view(&s.rpc, &s.mint.pubkey(), &s.receiver)
        .map_err(|e| anyhow!("{e}"))?;
    let supply = mint::read_total_supply(&s.rpc, &s.mint.pubkey()).map_err(|e| anyhow!("{e}"))?;

    let sender_ata = rust_service::ata::get_associated_token_address_with_program_id(
        &s.sender.pubkey(),
        &s.mint.pubkey(),
        &spl_token_2022::id(),
    );
    let receiver_ata = rust_service::ata::get_associated_token_address_with_program_id(
        &s.receiver.pubkey(),
        &s.mint.pubkey(),
        &spl_token_2022::id(),
    );

    let show_sender = roles.contains(&Role::OwnerSender);
    let show_receiver = roles.contains(&Role::OwnerReceiver);
    let show_auditor = roles.contains(&Role::Auditor);

    let mut balances = std::collections::HashMap::new();
    balances.insert(
        "sender".to_string(),
        to_balance_view(
            "sender",
            &s.sender.pubkey().to_string(),
            &sender_ata.to_string(),
            &sender_view,
            show_sender,
        ),
    );
    balances.insert(
        "receiver".to_string(),
        to_balance_view(
            "receiver",
            &s.receiver.pubkey().to_string(),
            &receiver_ata.to_string(),
            &receiver_view,
            show_receiver,
        ),
    );

    // Two independent visibility channels, kept on two separate wire fields
    // (see activity.rs's field docs) — `disclosed_amount_ui` means "an
    // auditor disclosed this" and must only ever reflect `show_auditor`;
    // `party_visible_amount_ui` means "you're one of this transfer's own two
    // parties" and must only ever reflect `is_party`. Merging them into one
    // field was tried and regressed the Audit Console: it made a party's own
    // transfer look auditor-disclosed to that same party's session, with no
    // way for the console to tell the difference.
    let mut activity = s.activity.all();
    for entry in activity.iter_mut() {
        let is_party = (show_sender
            && (entry.from_account_id == "sender" || entry.to_account_id == "sender"))
            || (show_receiver
                && (entry.from_account_id == "receiver" || entry.to_account_id == "receiver"));
        entry.party_visible_amount_ui = if is_party {
            entry.party_amount_ui
        } else {
            None
        };
        entry.disclosed_amount_ui = if show_auditor {
            entry.disclosed_amount_ui
        } else {
            None
        };
        entry.party_amount_ui = None;
    }
    let audit_disclosures = if show_auditor {
        s.disclosures.all()
    } else {
        Vec::new()
    };

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
        activity,
        audit_disclosures,
    })
}

fn to_balance_view(
    account_id: &str,
    address: &str,
    token_account: &str,
    v: &view::AccountView,
    reveal: bool,
) -> BalanceView {
    BalanceView {
        account_id: account_id.to_string(),
        address: address.to_string(),
        token_account: token_account.to_string(),
        public_balance: base_to_ui(v.public),
        confidential_available: ConfidentialAmountView {
            ciphertext: v.available_ciphertext_fingerprint.clone(),
            decrypted: reveal.then(|| base_to_ui(v.available)),
        },
        confidential_pending: ConfidentialAmountView {
            ciphertext: v.pending_ciphertext_fingerprint.clone(),
            decrypted: reveal.then(|| base_to_ui(v.pending)),
        },
    }
}
