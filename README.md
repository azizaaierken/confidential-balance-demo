# Confidential Balance Demo

A demo of Solana Token-2022 **Confidential Transfers** in the style of a
bank operations console: a Next.js frontend backed by a real Rust service that mints,
deposits, transfers, applies pending balances, withdraws, and handles
per-transfer auditor disclosure and auditor-key rotation on **Solana
devnet**.

Every signing key (payer, mint authority, sender, receiver, auditor
generations) lives only in the Rust service — the browser never holds a key
or a secret.

See [`CONFIDENTIAL_BALANCE_DEMO_REQUIREMENTS.md`](./CONFIDENTIAL_BALANCE_DEMO_REQUIREMENTS.md)
for the full product/requirements spec this demo implements.

## Structure

- [`rust-service/`](./rust-service) — Axum HTTP service wrapping Token-2022
  confidential-transfer operations (`spl-token-2022`, `spl-token-client`,
  `solana-zk-sdk`). Owns every keypair and talks to devnet directly.
- [`app/`](./app) — Next.js console (dashboard, per-account view, audit
  console, agent-payment demo) that drives the service over plain `fetch`.

## Running locally

### 1. Backend (`rust-service/`)

```bash
cd rust-service
cargo run --bin bootstrap   # one-shot: generates keys, airdrops the payer,
                             # creates the confidential mint, configures both
                             # personas' token accounts. Safe to re-run.
cargo run --bin server      # serves the HTTP API on :8787 (override with PORT)
```

This generates local keypairs under `rust-service/keys/` and a local
activity/disclosure log under `rust-service/data/` — both gitignored, since
they're per-environment runtime state, not source. Delete them to start over
with a fresh mint and fresh personas.

By default the service points at `https://api.devnet.solana.com`; override
with `SOLANA_RPC_URL` if you have your own devnet endpoint.

### 2. Frontend (`app/`)

```bash
cd app
npm install
npm run dev                 # serves the console on :3000
```

The frontend calls the backend at `http://localhost:8787` by default;
override with `NEXT_PUBLIC_BACKEND_URL` if the service runs elsewhere.

Open [http://localhost:3000](http://localhost:3000) once both are running.
