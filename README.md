# Confidential Balance Demo

A reference demo of Solana Token-2022 **Confidential Transfers** for a
bank-style operations console: a Next.js frontend backed by a Rust service
that mints, deposits, transfers, applies pending balances, withdraws, and
handles per-transfer auditor disclosure and auditor-key rotation on
**Solana devnet**.

> **Devnet only. Demo keys. Not production code.** Every signing key (payer,
> mint authority, both personas, every auditor generation) is a plain
> keypair file held by the Rust service, standing in for wallets, HSMs and an
> auditor's key custody. The point of the demo is the protocol flow and what
> each party can and cannot see, not the key management around it.

## What it shows

- **Confidential balances** on a Token-2022 mint with the
  `ConfidentialTransferMint` extension: public, pending and available
  balance states, and why pending funds must be applied before they spend.
- **A confidential transfer** as one V1 (SIMD-0385) transaction carrying the
  equality, ciphertext-validity and range proofs inline, with the exact
  transaction simulated on devnet before it is signed.
- **Deposits, withdrawals and minting** as public movements, labelled as such.
- **Per-transfer auditor disclosure**: the auditor's ElGamal ciphertext of
  each transfer amount is captured at transfer time and can be decrypted
  later with the matching auditor key generation, one transfer at a time.
  Decryption with the wrong generation fails safely.
- **Auditor key rotation**, with retired generations kept so historical
  transfers stay disclosable.
- **Role-based visibility** enforced server-side: the viewer switches on the
  sender's owner view, the receiver's, the auditor's, or any combination,
  and the backend redacts everything that combination is not entitled to
  see. The switches are the demo's stand-in for wallets and an authenticated
  auditor session — see *Roles and visibility* below.

## Structure

- [`rust-service/`](./rust-service) — Axum HTTP service wrapping the
  Token-2022 confidential-transfer operations (`spl-token-2022-interface`,
  `spl-token-confidential-transfer-proof-generation`, `solana-zk-sdk`).
  Owns every keypair, talks to devnet directly, and keeps a local activity
  and disclosure log.
- [`app/`](./app) — Next.js console (dashboard, per-account view, audit
  console; English, Simplified and Traditional Chinese) that drives the
  service over plain `fetch`.

## Running locally

### 1. Backend (`rust-service/`)

```bash
cd rust-service
cargo run --bin bootstrap   # one-shot: generates keys, airdrops the payer,
                            # creates the confidential mint, configures both
                            # personas' token accounts. Safe to re-run.
cargo run --bin server      # serves the HTTP API on :8787
```

This creates keypair files under `rust-service/keys/` and the local
activity/disclosure log under `rust-service/data/`. Both are gitignored
runtime state; delete them to start over with a fresh mint and fresh
personas.

Bootstrap tries to airdrop devnet SOL to the payer, but the public faucet is
rate-limited and frequently refuses. If it fails, fund the payer address it
prints from any wallet that already holds devnet SOL and re-run bootstrap:

```bash
solana transfer --url devnet --allow-unfunded-recipient <payer address> 2
```

or use [faucet.solana.com](https://faucet.solana.com).

Configuration is by environment variable; see
[`rust-service/.env.example`](./rust-service/.env.example) for the full list.
The public devnet RPC endpoint is rate-limited, so a dedicated devnet URL in
`SOLANA_RPC_URL` makes the demo noticeably smoother.

#### Roles and visibility

There are no logins. Each account page has a *Public observer view / Owner
view* switch (public by default), and the Audit Console has an *Auditor
view* switch (off by default). The frontend sends whatever is switched on
as an `X-Demo-Roles` header, and the backend redacts confidential balances,
transfer amounts and disclosure records for anything that is off, and
refuses owner or auditor actions the request is not viewing as.

That header is a UI switch, not a credential: anyone who can reach the port
can set it. What it preserves is the *shape* of who-sees-what, decided in
one place on the server. For that reason the service binds to `127.0.0.1`
and only accepts browser requests from `http://localhost:3000` by default;
change `BIND_ADDR` and `CORS_ORIGINS` deliberately if you run it on a
shared host, and expect anyone on that network to be able to move the demo's
devnet funds.

#### Key derivation

The ElGamal and AES keys that encrypt a persona's confidential balance are
never stored. They are derived on every use from the persona's Ed25519
signature using `solana-zk-sdk`'s current HKDF-SHA512 scheme. Accounts
provisioned before that migration used a different derivation and cannot be
decrypted under the new one; if you have such a `keys/` directory, run the
service with `LEGACY_KDF=1`. A fresh clone never needs it.

### 2. Frontend (`app/`)

```bash
cd app
pnpm install
pnpm dev                    # serves the console on :3000
```

The frontend calls the backend at `http://localhost:8787` by default;
override with `NEXT_PUBLIC_BACKEND_URL` (see
[`app/.env.example`](./app/.env.example)).

Open [http://localhost:3000](http://localhost:3000) once both are running.

## Checks

The CI workflow in [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)
runs the same commands:

```bash
# rust-service/
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
cargo test                  # unit tests: key derivation, role parsing, amounts

# app/
pnpm lint
pnpm test                   # vitest: i18n parity, redaction, permissions
pnpm build
pnpm typecheck
```

`cargo run --bin spike` runs a full mint → deposit → transfer → withdraw →
disclose round trip against devnet. It spends devnet SOL and mutates the
demo accounts, so it is a binary rather than a test.

## Deliberate simplifications

These are choices, not oversights, and each has an obvious production
counterpart:

- **Keys on the server.** Personas sign with keypair files the service
  holds. Production needs wallet-approved signing per party.
- **Role switches instead of authentication.** Owner and auditor views are
  toggled in the UI and sent as a header. Production needs real identity;
  the server-side redaction and permission checks would stay as they are.
- **The service pays every fee** from its own payer keypair, and the UI says
  so. Production would have each party pay or a bank sponsor explicitly.
- **Local JSON logs** stand in for an indexer or a database.
- **Devnet only.** Nothing here has been run against mainnet.
